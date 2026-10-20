import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { KingpinAuthority } from '../../kingpin/index.js';
import { startCde } from '../../evaluation/cde.js';
import { bindOperation } from './operation.mjs';
import { observeOperation } from './receiver.mjs';
import { createGovernance, fixturePolicy, fixtureInput, assertObservation } from './governance.mjs';
const python = new URL('../../.venv/bin/python', import.meta.url).pathname;
const bound = () => bindOperation(fixtureInput(), { sandbox_id: 'sandbox-trusted', request_id: randomUUID() });
const identity = b => ({ sandbox_id:b.representation.sandbox_id, request_id:b.representation.request_id,
  principal_id:'binding-agent', middleware_peer:'spiffe://openshell/sandbox/sandbox-trusted', operation_sha256:b.operation_sha256,binding_sha256:b.binding_sha256 });
const observation = (change={}) => observeOperation({method:'POST',target:'/resource/A?x=1&x=2',port:18089,
 rawHeaders:['Host','host.openshell.internal:18089','Content-Type','text/plain','X-Operation-Mode','first','X-Operation-Mode','second'],body:Buffer.from('data'),...change});
test('real CDE -> Kingpin binds exact operation and trusted identity; independent observation matches', async()=>{
 const cde=await startCde(python);try{
  const a=new KingpinAuthority({policy:fixturePolicy()});const b=bound();const records=[];
  const authorize=createGovernance({authority:a,evaluate:cde.evaluate,expectedDigest:b.operation_sha256,record:e=>records.push(e)});
  assert.equal(await authorize(b.representation,identity(b)),'allow');const g=records[0];
  assert.equal(g.signal.gate,0);assert.equal(g.decision.tool_floor_gate,1);
  assert.equal(g.audit.request_id,b.representation.request_id);assert.equal(g.request.args.identity.sandbox_id,'sandbox-trusted');
  assert.equal(assertObservation(g,[observation()]),true);
  for(const mutation of [{method:'PUT'},{target:'/resource/B?x=1&x=2'},{target:'/resource/A?x=2&x=1'},
   {rawHeaders:['Host','host.openshell.internal:18089','Content-Type','text/plain','X-Operation-Mode','changed']},{body:Buffer.from('changed')}]) {
    assert.throws(()=>assertObservation(g,[observation(mutation)]),/discrepancy/);
  }
  assert.throws(()=>assertObservation(g,[]));assert.throws(()=>assertObservation(g,[observation(),observation()]));
  const mutated=bound();mutated.representation.method='DELETE';await assert.rejects(authorize(mutated.representation,identity(mutated)),/Binding mismatch/);
 }finally{await cde.close();}
});
test('real CDE review, Kingpin unknown-tool denial, missing evidence, and governance failures never allow',async()=>{
 const cde=await startCde(python);try{
  const b=bound();const make=(opts={})=>createGovernance({authority:new KingpinAuthority({policy:fixturePolicy()}),evaluate:cde.evaluate,expectedDigest:b.operation_sha256,record:()=>{},...opts});
  assert.equal(await make({expectedDigest:'0'.repeat(64)})(b.representation,identity(b)),'deny');
  assert.equal(await make({evidence:false})(b.representation,identity(b)),'deny');
  await cde.evaluate({session_id:'review',turn_id:randomUUID(),ts:1,speaker_id:'binding-agent',channel_id:'openshell',text:'DO IT NOW!!! OR ELSE!!!'});
  let record;assert.equal(await make({session:'review',text:'',record:e=>record=e})(b.representation,identity(b)),'deny');
  assert.equal(record.signal.reason_codes[0],'LOW_CONFIDENCE');assert.equal(record.decision.outcome,'human_review');
  await assert.rejects(make({evaluate:async()=>({})})(b.representation,identity(b)),/Malformed/);
  await assert.rejects(make({record:()=>{throw Error('journal failed')}})(b.representation,identity(b)),/journal failed/);
  await cde.close();await assert.rejects(make()(b.representation,identity(b)),/unavailable/);
 }finally{await cde.close();}
});

test('post-decision mutation attempts cannot modify bridge operation or emit wire mutations',async()=>{
 const {createBridge}=await import('./bridge.mjs');const cde=await startCde(python);
 try{
  const b=bound();const govern=createGovernance({authority:new KingpinAuthority({policy:fixturePolicy()}),evaluate:cde.evaluate,expectedDigest:b.operation_sha256,record:()=>{}});
  const bridge=createBridge({audience:'test',sandboxPrincipals:{'sandbox-trusted':'binding-agent'},
   authenticate:()=>({principal_id:'mock-supervisor',sandbox_ids:['sandbox-trusted']}),authorize:async(op,id)=>{
    const decision=await govern(op,id);assert.equal(decision,'allow');
    for(const mutate of [()=>op.method='PUT',()=>op.canonical_path='/resource/B',()=>op.raw_query='x=2',
     ()=>op.application_headers[0][1]='changed',()=>op.body_sha256='0'.repeat(64)]) assert.throws(mutate,TypeError);
    return decision;
   }});
  const input=fixtureInput();const request={phase:'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS',middleware_name:'kingpin-binding',config:{fields:{}},
   context:{sandbox_id:'sandbox-trusted',request_id:randomUUID()},target:{...input.destination,method:input.method,path:input.path,query:input.query},
   headers:input.headers.map(([name,value])=>({name,value})),body:input.body};
  const result=await new Promise((resolve,reject)=>bridge.EvaluateHttpRequest({request},(e,r)=>e?reject(e):resolve(r)));
  assert.deepEqual(result,{decision:'DECISION_ALLOW'});
 }finally{await cde.close();}
});

test('a late governance result cannot reach Kingpin after the decision deadline',async()=>{
 let calls=0,records=0;
 const b=bound();const fn=createGovernance({authority:{decide(){calls++;}},expectedDigest:b.operation_sha256,record:()=>records++,evaluate:()=>new Promise(resolve=>setTimeout(()=>resolve({}),650))});
 await assert.rejects(fn(b.representation,identity(b)),/deadline/);
 await new Promise(resolve=>setTimeout(resolve,200));assert.equal(calls,0);assert.equal(records,0);
});
