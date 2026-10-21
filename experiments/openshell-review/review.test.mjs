import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {KingpinAuthority} from '../../kingpin/index.js';
import {SQLiteStateStore} from '../../kingpin/state/sqlite.js';
import {createAuthentication} from '../../kingpin/auth/access.js';
import {startCde} from '../../evaluation/cde.js';
import {bindOperation} from '../openshell-binding/operation.mjs';
import {fixtureInput,fixturePolicy} from '../openshell-binding/governance.mjs';
import {reviewHandlers,reviewControl} from './review.mjs';

test('real review persists; scoped approval never transfers to a fresh binding; reasons remain distinct',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'kingpin-review-test-'));const filename=join(dir,'state.sqlite');
 let store=new SQLiteStateStore({filename,create:true});let authority=new KingpinAuthority({store,policy:fixturePolicy()});
 const cde=await startCde(new URL('../../.venv/bin/python',import.meta.url).pathname);
 const context={session_id:'openshell-review',channel_id:'openshell',scene_id:null,task_id:null};
 const authentication=createAuthentication({schema_version:'1.0',principals:[
  {principal_id:'binding-agent',role:'agent',agent_id:'binding-agent',token:'a'.repeat(32),allowed_contexts:[context]},
  {principal_id:'reviewer',role:'reviewer',token:'r'.repeat(32),allowed_contexts:[context]},
  {principal_id:'wrong-scope',role:'reviewer',token:'w'.repeat(32),allowed_contexts:[{...context,session_id:'other'}]}
 ]});
 const control=(action,reviewId,token='r',attempt)=>reviewControl({authority,authentication,authorization:`Bearer ${token.repeat(32)}`,action,reviewId,attempt});
 const run=async(scenario='review',claims=[])=>{
  if(scenario==='review')await cde.evaluate({session_id:context.session_id,turn_id:randomUUID(),ts:1,speaker_id:'binding-agent',channel_id:'openshell',text:'DO IT NOW!!! OR ELSE!!!'});
  const input=fixtureInput(),id=randomUUID();let event;
  const handlers=reviewHandlers({authority,evaluate:cde.evaluate,record:e=>event=e,scenario,
   expectedDigest:bindOperation(input,{sandbox_id:'trusted',request_id:id}).operation_sha256,
   audience:'test',sandboxPrincipals:{trusted:'binding-agent'},authenticate:()=>({principal_id:'mock-supervisor',sandbox_ids:['trusted']})});
  const request={phase:'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS',middleware_name:'kingpin-binding',config:{fields:{}},context:{sandbox_id:'trusted',request_id:id},
   target:{...input.destination,method:input.method,path:scenario==='deny'?'/resource/B':input.path,query:input.query},headers:[...input.headers,...claims].map(([name,value])=>({name,value})),body:input.body};
  const result=await new Promise((ok,bad)=>handlers.EvaluateHttpRequest({request},(e,r)=>e?bad(e):ok(r)));
  assert.equal(result.decision,'DECISION_DENY');return {event,result};
 };
 try{
  const first=await run();assert.equal(first.result.reason_code,'kingpin_review_required');assert.equal(first.event.decision.outcome,'human_review');
  const id=first.event.review_id;assert.equal(control('inspect',id).status,'pending');
  for(const token of ['x','a','w'])assert.throws(()=>control('approve',id,token));
  const approved=control('approve',id);assert.equal(approved.execution_authorized,false);assert.equal(approved.review.consumed_at,null);
  store.close();store=new SQLiteStateStore({filename});authority=new KingpinAuthority({store,policy:fixturePolicy()});
  assert.equal(control('inspect',id).status,'approved');
  const fresh=await run('review',[['x-review-id',id],['x-kp-request-id',first.event.identity.request_id],['x-sandbox-id','fake']]);
  assert.equal(fresh.result.reason_code,'kingpin_review_required');assert.equal(fresh.event.operation_sha256,first.event.operation_sha256);
  assert.notEqual(fresh.event.binding_sha256,first.event.binding_sha256);
  const attempt={...fresh.event,originalReview:{review_id:id,request_id:first.event.identity.request_id}};
  assert.throws(()=>control('consume-fresh',id,'r',attempt));assert.equal(control('inspect',id).status,'approved');
  const rejected=control('consume-fresh',id,'a',attempt);assert.equal(rejected.execution_authorized,false);assert.equal(rejected.reason,'REQUEST_BINDING_CHANGED');
  const final=control('inspect',id);assert.equal(final.status,'invalidated');assert.equal(final.resolution,'approve');assert.equal(final.consumed_at,null);
  assert.equal((await run('deny')).result.reason_code,'kingpin_denied');
  assert.equal((await run('constrain')).result.reason_code,'kingpin_constrained');
 }finally{await cde.close();store.close();rmSync(dir,{recursive:true,force:true})}
});
