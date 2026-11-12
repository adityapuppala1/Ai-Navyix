/** Test double only; not an application storage or authentication fallback. */
import { createHash, randomUUID } from 'node:crypto';
import { EvidenceJournalService } from '../../src/evidence-journal.mjs';
export const ORG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PROJECT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', USER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const OTHER='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const PRINCIPAL={issuer:'https://identity.test',subject:'actor'};
export const INPUT={expectedRevision:2,buildId:'BLD-001',runId:'123',attempt:'1'};
export function fixture() {
 const state={actor:{userId:USER,role:'OWNER',active:true,userActive:true,organizationActive:true},membership:{role:'OWNER',active:true},
   project:{id:PROJECT,revision:2,builds:[{id:'BLD-001',commitSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),environment:'staging'}]},records:[],receipts:{},audits:[]};
 let now=Date.parse('2026-11-12T05:00:00Z');
 const control={state,fetches:0,inside:false,mutate:null,fail:null,context:null};
 const repository={async transaction(context,fn){
  control.context=context;const draft=structuredClone(state);control.inside=true;
  const tx={
   actor:async()=>context.principal.subject==='actor'&&context.orgId===ORG?draft.actor:null,
   projectMembership:async(id)=>id===PROJECT?draft.membership:null,
   project:async(id)=>id===PROJECT?draft.project:null,
   count:async(id)=>draft.records.filter(r=>r.projectId===id).length,
   receipt:async(actor,key)=>draft.receipts[actor+'/'+key],
   saveReceipt:async(actor,key,requestHash,result)=>{if(control.fail==='receipt')throw Error('receipt failed');draft.receipts[actor+'/'+key]={requestHash,result};},
   insert:async(r)=>{draft.records.push(structuredClone(r));},
   audit:async(r)=>{if(control.fail==='audit')throw Error('audit failed');draft.audits.push(r.id);},
   get:async(id,key)=>draft.records.find(r=>r.orgId===context.orgId&&r.projectId===id&&r.id===key),
   list:async(id,cursor,limit)=>draft.records.filter(r=>r.orgId===context.orgId&&r.projectId===id&&(!cursor||r.recordedAt<cursor.recordedAt||(r.recordedAt===cursor.recordedAt&&r.id<cursor.id)))
    .sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||b.id.localeCompare(a.id)).slice(0,limit)
  };
  try{const result=await fn(tx);Object.assign(state,draft);return result;}finally{control.inside=false;}
 }};
 const collector={async inspect(principal,org,project,target){
  if(control.inside)throw Error('External request inside a transaction');control.fetches++;
  const value={schemaVersion:1,kind:'github-run-observation',orgId:org,projectId:project,projectRevision:2,target:structuredClone(state.project.builds[0]),
   source:{id:Number(target.runId),attempt:Number(target.attempt),commitSha:'a'.repeat(40),repository:'example/repo',repositoryId:1,workflowId:7,url:`https://github.com/example/repo/actions/runs/${target.runId}/attempts/${target.attempt}`},
   collectedAt:new Date(now).toISOString(),summary:'Reported success',criteria:[],jobs:[],artifactVerified:false,testCoverageVerified:false,readinessEffect:'none'};
  value.target.buildId=value.target.id;delete value.target.id;
  if(control.mutate)await control.mutate(value);
  return {...value,contentSha256:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
 }};
 const service=new EvidenceJournalService(repository,collector,{clock:()=>now});
 return { ...control, control,state,repository,collector,service,advance:ms=>{now+=ms;}, capture:(input=INPUT,key=randomUUID(),principal=PRINCIPAL,org=ORG,project=PROJECT)=>service.capture(principal,org,project,input,key) };
}
