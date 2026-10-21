import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {KingpinAuthority} from '../../kingpin/index.js';
import {SQLiteStateStore} from '../../kingpin/state/sqlite.js';
import {createAuthentication} from '../../kingpin/auth/access.js';
import {fixturePolicy} from '../openshell-binding/governance.mjs';
import {reviewControl} from './review.mjs';
const dir=process.env.REVIEW_STATE;if(!dir)throw Error('REVIEW_STATE required');
const [action,reviewId,requestId]=process.argv.slice(2);
const store=new SQLiteStateStore({filename:join(dir,'governance.sqlite')});
try{
 const authority=new KingpinAuthority({store,policy:fixturePolicy()});
 const authentication=createAuthentication(JSON.parse(readFileSync(join(dir,'auth.json'))));
 const events=readFileSync(join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const original=events.find(e=>e.type==='governance'&&e.review_id===reviewId);
 const observed=events.find(e=>e.type==='governance'&&e.identity.request_id===requestId);
 const attempt=observed?{...observed,originalReview:{review_id:original?.review_id,request_id:original?.audit.request_id}}:undefined;
 const result=reviewControl({authority,authentication,authorization:`Bearer ${process.env.REVIEW_TOKEN??''}`,action,reviewId,attempt});
 appendFileSync(join(dir,'control.jsonl'),JSON.stringify({at:new Date().toISOString(),action,reviewId,requestId,result})+'\n',{mode:0o600});
 console.log(JSON.stringify(result));
}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}finally{store.close()}
