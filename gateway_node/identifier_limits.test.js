import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTIFIER_LIMITS, validateIdentifiers } from './identifier_limits.js';
import { createGatewayApp } from './server.js';
import { createAuthentication } from '../kingpin/auth/access.js';
import { KingpinAuthority } from '../kingpin/index.js';
import { config, headers, authentication, dispatch } from '../tests/fixtures/auth.mjs';
import { startCde } from '../evaluation/cde.js';
import { pythonExecutable } from '../conformance/runtime.mjs';

const packet = { turn_id:'short', ts:1, speaker_id:'actor', session_id:'s', channel_id:'channel',
  scene_id:'scene', task_id:null, text:'!!! '.repeat(128) };

test('shared metadata bounds count UTF-8 bytes, reject invalid Unicode, and ignore override hints', () => {
  for (const [name, limit] of Object.entries(IDENTIFIER_LIMITS)) {
    for (const char of ['x','é','😀']) {
      const value = char.repeat(limit / Buffer.byteLength(char));
      validateIdentifiers({ [name]:value });
      assert.throws(() => validateIdentifiers({ [name]:value+'x', policy_state:{identifier_limit:999999} }));
    }
    assert.throws(() => validateIdentifiers({ [name]:'\ud800' }));
  }
});

test('overlong turn metadata is refused before CDE/authority; tool failure stays correlated and audited', async () => {
  let calls = 0;
  const authority = new KingpinAuthority();
  const app = createGatewayApp({ authentication, authority, evaluateTurn(){calls++;throw Error('must not run');}, logDecision(){} });
  for (const size of [129,4096]) {
    for (const route of ['/turn','/tool']) {
      const result = await dispatch(app, route, { ...packet, turn_id:'x'.repeat(size), tool:'fs.list', args:{}, plan_id:'p', user_request:'read' });
      assert.equal(result.statusCode,400);
      assert.ok(result.headers['X-Request-ID']);
      const events = authority.getEventsForRequest(result.headers['X-Request-ID']);
      assert.deepEqual(events.map(e=>e.event_type), route === '/tool' ? ['tool.enforcement.failed'] : []);
    }
  }
  assert.equal(calls,0); assert.equal(authority.states.size,0);
});

test('every oversized context field is rejected even if trusted auth configuration permits it', async () => {
  for (const [name, limit] of Object.entries(IDENTIFIER_LIMITS).filter(([name])=>!['turn_id','tool'].includes(name))) {
    const body = {...packet,[name]:'x'.repeat(limit+1)}, copy=structuredClone(config);
    const agent=copy.principals[0];
    if(name==='speaker_id') agent.agent_id=body[name]; else agent.allowed_contexts[0][name]=body[name];
    let calls=0;
    const app=createGatewayApp({authentication:createAuthentication(copy),evaluateTurn(){calls++;},logDecision(){}});
    const result=await dispatch(app,'/turn',body);
    assert.equal(result.statusCode,400,name); assert.equal(calls,0);
  }
});

test('real authenticated turn ingress bounds serialized evidence and never invokes CDE for hostile IDs', async t => {
  const cde=await startCde(pythonExecutable()); t.after(()=>cde.close());
  let calls=0;
  const authority=new KingpinAuthority();
  const app=createGatewayApp({authentication,authority,logDecision(){},evaluateTurn(body){calls++;return cde.evaluate(body);}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  for(const size of [16,128,129,4096]) {
    const before=calls;
    const result=await fetch(`http://127.0.0.1:${server.address().port}/turn`,{method:'POST',headers:{...headers(),'content-type':'application/json'},body:JSON.stringify({...packet,turn_id:'x'.repeat(size)}),signal:AbortSignal.timeout(30000)});
    const text=await result.text(); assert.ok(result.headers.get('x-request-id'));
    if(size<=128) {
      assert.equal(result.status,200); assert.equal(calls,before+1);
      assert.equal(JSON.parse(text).top_event.evidence.length,128);
      assert.ok(Buffer.byteLength(text)<300000);
    } else {assert.equal(result.status,400);assert.equal(calls,before);assert.ok(Buffer.byteLength(text)<100);}
  }
  assert.equal(authority.states.size,0); // /turn evaluates signals only.
});


test('oversized unknown tool identifiers cannot inflate audit summaries', async () => {
  let calls=0;
  const authority=new KingpinAuthority();
  const app=createGatewayApp({authentication,authority,evaluateTurn(){calls++;},logDecision(){}});
  const result=await dispatch(app,'/tool',{...packet,tool:'x'.repeat(257),plan_id:'p',user_request:'read'});
  assert.equal(result.statusCode,400);assert.equal(calls,0);assert.equal(authority.states.size,0);
  const events=authority.getEventsForRequest(result.headers['X-Request-ID']);
  assert.equal(events.length,1);assert.equal(events[0].tool_id,null);
});

test('limits definitions reject missing/extra fields and invalid numeric values at load validation', async () => {
  const { validateLimitsDefinition } = await import('./identifier_limits.js');
  const valid = () => ({schema_version:'1.0',max_utf8_bytes:{...IDENTIFIER_LIMITS}});
  for (const value of [null, [], {}, {...valid(),schema_version:'2.0'}, {...valid(),extra:true}, {...valid(),max_utf8_bytes:[]}]) {
    assert.throws(()=>validateLimitsDefinition(value));
  }
  for (const name of Object.keys(IDENTIFIER_LIMITS)) {
    const missing=valid();delete missing.max_utf8_bytes[name];assert.throws(()=>validateLimitsDefinition(missing));
    for (const value of ['256',0,-1,NaN,Infinity,-Infinity,true,null,{},[],1.5,Number.MAX_SAFE_INTEGER+1]) {
      const bad=valid();bad.max_utf8_bytes[name]=value;assert.throws(()=>validateLimitsDefinition(bad),`${name}: ${value}`);
    }
  }
  const extra=valid();extra.max_utf8_bytes.other=256;assert.throws(()=>validateLimitsDefinition(extra));
  const source=valid(), loaded=validateLimitsDefinition(source);source.max_utf8_bytes.turn_id=999;
  assert.equal(loaded.turn_id,128);assert.ok(Object.isFrozen(loaded));
  const integral=valid();integral.max_utf8_bytes.turn_id=128.0;assert.equal(validateLimitsDefinition(integral).turn_id,128);
});
