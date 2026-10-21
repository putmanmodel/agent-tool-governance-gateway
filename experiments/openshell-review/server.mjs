import { createRequire } from 'node:module';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KingpinAuthority } from '../../kingpin/index.js';
import { SQLiteStateStore } from '../../kingpin/state/sqlite.js';
import { startCde } from '../../evaluation/cde.js';
import { Middleware } from '../openshell-binding/bridge.mjs';
import { extensionAuthenticator } from '../openshell-binding/auth.mjs';
import { createReceiver } from '../openshell-binding/receiver.mjs';
import { representOperation, operationDigest } from '../openshell-binding/operation.mjs';
import { fixturePolicy, fixtureInput } from '../openshell-binding/governance.mjs';
import { reviewHandlers } from './review.mjs';
const grpc = createRequire(new URL('../openshell-binding/package.json',import.meta.url))('@grpc/grpc-js');
const dir = process.env.REVIEW_STATE;if (!dir) throw Error('REVIEW_STATE required');
const read = n => readFileSync(join(dir,n));
const record = event => { const fd=openSync(join(dir,'events.jsonl'),'a',0o600);try {writeFileSync(fd,JSON.stringify({at:new Date().toISOString(),...event})+'\n');fsyncSync(fd)}finally{closeSync(fd)} };
const store=new SQLiteStateStore({filename:join(dir,'governance.sqlite'),create:process.argv.includes('--initialize')});
const authority=new KingpinAuthority({store,policy:fixturePolicy()});
const cde=await startCde(resolve('.venv/bin/python'),join(dir,'cde.lock'));
const authenticate=extensionAuthenticator({publicKey:read('gateway-public.pem'),kid:read('gateway-kid').toString().trim(),issuer:'openshell-gateway:openshell',audience:'urn:kingpin:binding',onAuthenticated:e=>record({type:'authenticated',...e})});
const expectedDigest=operationDigest(representOperation(fixtureInput()));
const handlers={};
for(const method of ['Describe','ValidateConfig','EvaluateHttpRequest']) handlers[method]=async(call,callback)=>{
 try{
  const cfg=JSON.parse(read('operator.json'));
  if(method==='EvaluateHttpRequest'){
   authenticate(call);record({type:'middleware_input',context:call.request.context,target:call.request.target,headers:call.request.headers});
   // Operator-only real CDE history ensures LOW_CONFIDENCE is repeatable. No
   // fabricated signal or Kingpin state reset; history remains in the journal.
   if(cfg.scenario==='review') {const result=await cde.evaluate({session_id:'openshell-review',turn_id:crypto.randomUUID(),ts:Date.now()/1000,speaker_id:'binding-agent',channel_id:'openshell',text:'DO IT NOW!!! OR ELSE!!!'});record({type:'cde_history',result});}
  }
  await reviewHandlers({authority,evaluate:cde.evaluate,record,scenario:cfg.scenario,expectedDigest,authenticate,
   sandboxPrincipals:cfg.sandboxPrincipals,audience:'urn:kingpin:binding',timeoutMs:1000})[method](call,(err,result)=>{
   if(method==='EvaluateHttpRequest')record({type:'middleware_result',request_id:call.request.context?.request_id,result,error:!!err});callback(err,result);
  });
 }catch(e){record({type:'failure',message:e.message});callback({code:grpc.status.PERMISSION_DENIED,message:'Unavailable'});}
};
const server=new grpc.Server({'grpc.max_receive_message_length':512*1024});server.addService(Middleware.service,handlers);
await new Promise((ok,bad)=>server.bindAsync('127.0.0.1:18443',grpc.ServerCredentials.createSsl(null,[{private_key:read('tls.key'),cert_chain:read('tls.crt')}]),e=>e?bad(e):ok()));
const receiver=createReceiver({onRecord:r=>record({type:'receiver',...r})});receiver.server.listen(18089,'0.0.0.0');
console.log('Candidate B ready');
process.on('SIGTERM',async()=>{server.forceShutdown();receiver.server.close();await cde.close();store.close();process.exit(0)});
