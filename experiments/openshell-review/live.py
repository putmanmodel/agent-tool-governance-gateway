"""Bounded host runner. Requires prepared REVIEW_STATE and qualified runtime/CLI config.
Credentials stay in private auth.json; workload input never selects a review.
"""
import json,os,pathlib,subprocess
r=pathlib.Path(os.environ['REVIEW_STATE']);runtime=pathlib.Path(os.environ['REVIEW_RUNTIME']);env=dict(os.environ,XDG_CONFIG_HOME=str(runtime/'config'));results=[]
def events(): return [json.loads(x) for x in (r/'events.jsonl').read_text().splitlines()]
def probe(case,scenario='review',path='/resource/A?x=1&x=2',claims=None):
 cfg=json.loads((r/'operator.json').read_text());cfg['scenario']=scenario;(r/'operator.json').write_text(json.dumps(cfg));before=len(events())
 q={'path':path,'headers':{'content-type':'text/plain','x-operation-mode':['first','second'],**(claims or {})}}
 code="""const q=REQUEST;const r=require('http').request({host:'host.openshell.internal',port:18089,path:q.path,method:'POST',agent:false,headers:{...q.headers,'content-length':4}},s=>{let b='';s.on('data',x=>b+=x);s.on('end',()=>console.log(JSON.stringify({status:s.statusCode,body:JSON.parse(b)})))});r.on('error',e=>{console.error(e.message);process.exitCode=1});r.setTimeout(5000,()=>r.destroy(Error('timeout')));r.end('data');""".replace('REQUEST',json.dumps(q))
 p=subprocess.run([str(runtime/'openshell'),'sandbox','exec','kp-requal','--','/sandbox/node','-e',code],env=env,capture_output=True,text=True,timeout=12,check=True);response=json.loads(p.stdout)
 code={'review':'kingpin_review_required','deny':'kingpin_denied','constrain':'kingpin_constrained'}[scenario]
 assert response['status']==403 and response['body'].get('reason_code')==code,('STOP: requester-visible reason lost',response)
 fresh=events()[before:];g=next(e for e in fresh if e['type']=='governance');assert not any(e['type']=='receiver' for e in events())
 assert any(e['type']=='authenticated' and e['sandbox_id']==g['identity']['sandbox_id'] and e['request_id']==g['identity']['request_id'] for e in fresh)
 assert (g['review_id'] is not None)==(scenario=='review')
 results.append({'case':case,'response':response,'review_id':g['review_id'],'request_id':g['identity']['request_id'],'receiver_effects':0});save();print(case,code,flush=True);return g

def save():(r/'results.json').write_text(json.dumps(results,indent=2))
def control(action,review,role='reviewer-b',attempt=None,ok=True):
 principals=json.loads((r/'auth.json').read_text())['principals'];token=next(p['token'] for p in principals if p['principal_id']==role) if role!='invalid' else 'invalid'
 p=subprocess.run(['node','experiments/openshell-review/control.mjs',action,review,attempt or ''],env=dict(os.environ,REVIEW_STATE=str(r),REVIEW_TOKEN=token),capture_output=True,text=True)
 assert (p.returncode==0)==ok,(action,p.stdout,p.stderr)
 result=json.loads(p.stdout) if ok else {'rejected':True};results.append({'case':'control-'+action,'principal':role,'result':result});save();return result

first=probe('review-initial') # STOP here if the required reason is not relayed.
review=first['review_id'];pending=control('inspect',review);assert pending['status']=='pending'
for role in ['invalid','binding-agent','reviewer-other']:control('approve',review,role,ok=False)
assert control('inspect',review)['status']=='pending'
approved=control('approve',review);assert approved['review']['status']=='approved' and approved['execution_authorized'] is False
assert approved['review']['consumed_at'] is None
assert control('inspect',review)['status']=='approved';assert not any(e['type']=='receiver' for e in events())
fresh=probe('fresh-attempt-spoof',claims={'x-review-id':review,'x-kp-request-id':first['identity']['request_id'],'x-sandbox-id':'fake','x-kingpin-principal':'reviewer-b','x-approved':'true'})
assert fresh['identity']['request_id']!=first['identity']['request_id'];assert fresh['identity']['sandbox_id']==first['identity']['sandbox_id'];assert fresh['operation_sha256']==first['operation_sha256'];assert fresh['binding_sha256']!=first['binding_sha256']
control('consume-fresh',review,'reviewer-b',fresh['identity']['request_id'],ok=False)
assert control('inspect',review)['status']=='approved'
result=control('consume-fresh',review,'binding-agent',fresh['identity']['request_id']);assert result['execution_authorized'] is False and result['reason']=='REQUEST_BINDING_CHANGED'
invalidated=control('inspect',review);assert invalidated['status']=='invalidated' and invalidated['resolution']=='approve' and invalidated['consumed_at'] is None
control('consume-fresh',review,'binding-agent',fresh['identity']['request_id'],ok=False)
assert control('deny',fresh['review_id'])['review']['status']=='denied'
probe('ordinary-deny','deny','/resource/B?x=1&x=2');probe('constrain','constrain')
assert not any(e['type']=='receiver' for e in events());print('PASS: review visibility, resolution, non-transferability; zero effects',flush=True)
