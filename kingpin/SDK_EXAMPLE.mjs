// Synthetic compatible signals; no live CDE or execution. Run in a fresh directory.
import assert from 'node:assert/strict';
import {KingpinAuthority,MemoryStateStore} from 'kingpin-runtime';
import {SQLiteStateStore} from 'kingpin-runtime/state/sqlite';
import {createAuthentication} from 'kingpin-runtime/auth';
import {randomBytes} from 'node:crypto';
const tokens=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
const auth=createAuthentication({schema_version:'1.0',principals:[
 {principal_id:'agent-principal',role:'agent',agent_id:'agent',token:tokens[0],allowed_contexts:[{session_id:'session',channel_id:'channel',scene_id:null,task_id:null}]},
 {principal_id:'reviewer-principal',role:'reviewer',token:tokens[1]}
]});
const agent=auth.authenticate(`Bearer ${tokens[0]}`),reviewer=auth.authenticate(`Bearer ${tokens[1]}`);
const request={speaker_id:'agent',session_id:'session',channel_id:'channel',tool:'fs.list',args:{path:'/bounded'},dry_run:true,diff:'bounded proposed operation'};
const signal={schema_version:'1.0',scope_key:'agent:agent',gate:1,gate_label:'EVIDENCE REQUIRED',evidence_requirements:['dry_run','diff'],authority:{requirement:'none',recommendation:'none'},reason_codes:['LOW_CONFIDENCE'],deviation:{severity:0.5,ema_severity:0.5,confidence:0.2,active:true,enter:false,exit:false,vector:{}}};
for(const backend of ['memory','sqlite']){
 let store=backend==='memory'?new MemoryStateStore():new SQLiteStateStore({filename:'example.sqlite',create:true});
 try{
  let authority=new KingpinAuthority({store});
  auth.authorize(agent,'runtime.evaluate',request);
  const decision=authority.decide(signal,request,`${backend}-evaluation`,{request_id:`${backend}-request`,principal_id:agent.principal_id});
  assert.equal(decision.outcome,'human_review');
  const reviewId=authority.reviewIdForDecision(decision); // Persist this ID in host workflow state.
  assert.equal(authority.resolveReview(reviewId,'approve',reviewer).execution_authorized,false);
  const consumed=authority.consumeReview(reviewId,request,agent);
  assert.equal(consumed.execution_authorized,true); // Permission only: no operation is executed here.
  const lease=authority.issue({...request,seconds:60}); // Trusted administrative call.
  authority.revokeLeaseNonce(lease.lease_id);
  assert.equal(authority.validateLease({...request,lease_token:lease.lease_token}).reason,'nonce_revoked');
  authority.revokeAllLeases();
  if(backend==='sqlite'){
   store.close();store=new SQLiteStateStore({filename:'example.sqlite'});authority=new KingpinAuthority({store});
   assert.equal(authority.getReview(reviewId,reviewer).status,'consumed');
   assert.equal(authority.validateLease({...request,lease_token:lease.lease_token}).reason,'epoch_revoked');
  }
 }finally{store.close();}
}
console.log('Memory and SQLite example PASS; authorization only; limited public prerelease example');
