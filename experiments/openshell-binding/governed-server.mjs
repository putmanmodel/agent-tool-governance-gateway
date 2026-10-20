import grpc from '@grpc/grpc-js';
import { readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KingpinAuthority } from '../../kingpin/index.js';
import { SQLiteStateStore } from '../../kingpin/state/sqlite.js';
import { startCde } from '../../evaluation/cde.js';
import { createBridge, Middleware } from './bridge.mjs';
import { extensionAuthenticator } from './auth.mjs';
import { createReceiver } from './receiver.mjs';
import { representOperation, operationDigest } from './operation.mjs';
import { createGovernance, fixturePolicy, fixtureInput } from './governance.mjs';

const dir = process.env.BINDING_STATE;
if (!dir) throw Error('BINDING_STATE required');
const read = name => readFileSync(join(dir, name));
const config = () => JSON.parse(read('operator.json'));
const record = event => {
  const fd = openSync(join(dir,'governed.jsonl'),'a',0o600);
  try { writeSync(fd, JSON.stringify({at:new Date().toISOString(),...event})+'\n'); fsyncSync(fd); } finally { closeSync(fd); }
};
const store = new SQLiteStateStore({filename:join(dir,'governance.sqlite'),create:process.argv.includes('--initialize')});
const authority = new KingpinAuthority({store,policy:fixturePolicy()});
const cde = await startCde(resolve('.venv/bin/python'),join(dir,'cde.lock'));
const authenticate = extensionAuthenticator({publicKey:read('gateway-public.pem'),kid:read('gateway-kid').toString().trim(),
 issuer:'openshell-gateway:openshell',audience:'urn:kingpin:binding',onAuthenticated:e=>record({type:'authenticated',...e})});
// Explicit test history in a separate operator-selected context, never a supplied signal.
const warm = await cde.evaluate({session_id:'binding-review',turn_id:crypto.randomUUID(),ts:Date.now()/1000,
 speaker_id:'binding-agent',channel_id:'openshell',text:'DO IT NOW!!! OR ELSE!!!'});
record({type:'cde_fixture_history',session:'binding-review',signal:warm.governance_signal});
const server=new grpc.Server({'grpc.max_receive_message_length':512*1024});
const handlers={};
for(const method of ['Describe','ValidateConfig','EvaluateHttpRequest']) handlers[method]=async(call,callback)=>{
 try{
  const cfg=config();
  if(method==='EvaluateHttpRequest'){
   authenticate(call);
   record({type:'middleware_input',context:call.request.context,target:call.request.target,headers:call.request.headers});
   if(cfg.fault==='unavailable') await cde.close();
  }
  const authorize=createGovernance({authority,record,expectedDigest:operationDigest(representOperation(fixtureInput())),
   session:cfg.scenario==='review'?'binding-review':'openshell-binding',text:cfg.scenario==='review'?'':'Please perform the bounded fixture operation.',
   evidence:cfg.scenario!=='missing-evidence',evaluate:cfg.fault==='malformed'?async()=>({}):cfg.fault==='timeout'?()=>new Promise(()=>{}):cde.evaluate});
  await createBridge({authenticate,authorize,sandboxPrincipals:cfg.sandboxPrincipals,audience:'urn:kingpin:binding',timeoutMs:1000})[method](call,(error,result)=>{
   if(method==='EvaluateHttpRequest')record({type:'middleware_result',request_id:call.request.context?.request_id,error:!!error,result});
   callback(error,result);
  });
 }catch(error){record({type:'bridge_error',message:error.message});callback({code:grpc.status.UNAUTHENTICATED,message:'Unavailable'});}
};
server.addService(Middleware.service,handlers);
await new Promise((ok,bad)=>server.bindAsync('127.0.0.1:18443',grpc.ServerCredentials.createSsl(null,[{private_key:read('tls.key'),cert_chain:read('tls.crt')}]),e=>e?bad(e):ok()));
const receiver=createReceiver({onRecord:r=>record({type:'receiver',...r})});receiver.server.listen(18089,'0.0.0.0');
record({type:'start',policy:fixturePolicy(),expected_digest:operationDigest(representOperation(fixtureInput()))});
console.log('Governed middleware and independent receiver ready');
process.on('SIGUSR1',()=>{record({type:'middleware_unavailable_receivers_running'});server.forceShutdown()});
process.on('SIGTERM',async()=>{server.forceShutdown();receiver.server.close();await cde.close();store.close();process.exit(0)});
