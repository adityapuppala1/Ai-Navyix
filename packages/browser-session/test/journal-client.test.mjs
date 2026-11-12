import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspace } from '../src/client.mjs';
import { EvidenceJournalClient } from '../src/journal-client.mjs';
const O='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',R='cccccccc-cccc-4ccc-8ccc-cccccccccccc',K='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function setup(){
 const control={override:null,calls:[],revision:2,records:[],commits:0};
 const record=()=>({id:R,orgId:O,projectId:P,projectRevision:2,currentProjectRevision:control.revision,matchesCurrentRevision:control.revision===2,recordedAt:new Date().toISOString(),recordSha256:'a'.repeat(64),observation:{orgId:O,projectId:P,projectRevision:2,target:{buildId:'BLD-001'},source:{repository:'example/repo',id:123,attempt:1},summary:'Reported success',artifactVerified:false,testCoverageVerified:false,readinessEffect:'none'}});
 const fetcher=async(path,init)=>{
  control.calls.push({path,init});if(control.override){const r=await control.override(path,init);if(r!==undefined)return r;}
  if(path.endsWith('/session'))return Response.json({authenticated:true,csrfToken:'token',expiresAt:new Date(Date.now()+600000).toISOString()});
  if(path.endsWith('/github-observations')&&init.method==='POST'){if(!control.records.length){control.records=[record()];control.commits++;}return Response.json({observationId:R,orgId:O,projectId:P,projectRevision:2,requestId:K,recordSha256:'a'.repeat(64)});}
  if(path.includes('github-observations?'))return Response.json({orgId:O,projectId:P,observations:control.records.map(r=>({...r,source:r.observation.source,target:r.observation.target,summary:r.observation.summary,readinessEffect:'none'})),next:null});
  if(path.endsWith('/github-observations/'+R))return Response.json(record());
  if(path.includes('readiness?'))return Response.json({projectId:P,projectRevision:control.revision,stage:new URL(path,'https://test.invalid').searchParams.get('stage'),environment:'staging',buildId:'BLD-001',artifactDigest:'sha256:'+'b'.repeat(64),criteria:[],status:'Insufficient evidence'});
  if(path.includes('projects?'))return Response.json({projects:[{id:P,name:'Test'}],next:null});
  return Response.json({id:P,revision:control.revision,environment:'staging',builds:[{id:'BLD-001',artifactDigest:'sha256:'+'b'.repeat(64)}]});
 };
 const workspace=new BrowserWorkspace({fetcher}),client=new EvidenceJournalClient({workspace,uuid:()=>K});
 const connect=async()=>{await workspace.init();await client.connect(O);};
 return{control,workspace,client,connect,record};
}
const target={buildId:'BLD-001',runId:'123',attempt:'1'};
test('real browser adapter captures, reloads and selects scoped history',async()=>{const f=setup();await f.connect();await f.client.capture(target);assert.equal(f.client.selected.id,R);assert.equal(f.client.rows.length,1);assert.equal(f.control.commits,1);assert.equal(f.workspace.project.revision,2);for(const c of f.control.calls){assert.equal(c.init.headers.authorization,undefined);assert.equal(c.init.credentials,'same-origin');}});
test('unconfirmed capture retries identical payload/key and produces one persistent effect',async()=>{
 const f=setup();await f.connect();let first=true;
 f.control.override=(path,init)=>{if(path.endsWith('github-observations')&&init.method==='POST'&&first){first=false;f.control.records=[f.record()];f.control.commits++;throw Error('lost response');}};
 await assert.rejects(f.client.capture(target));assert.ok(f.client.pending);
 for(const fn of [()=>f.client.connect(O),()=>f.client.project(P),()=>f.client.history(),()=>f.client.capture(target)])await assert.rejects(fn(),e=>e.code==='PENDING_WRITE');
 await f.client.retry();const posts=f.control.calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].init.body,posts[1].init.body);assert.equal(posts[0].init.headers['idempotency-key'],posts[1].init.headers['idempotency-key']);assert.equal(f.control.commits,1);
});
test('invalid acknowledgement keeps the original capture pending',async()=>{const f=setup();await f.connect();f.control.override=(p,i)=>i.method==='POST'?Response.json({observationId:R,orgId:O,projectId:P,projectRevision:999,requestId:K,recordSha256:'a'.repeat(64)}):undefined;await assert.rejects(f.client.capture(target),e=>e.code==='UNCONFIRMED_ACK');assert.ok(f.client.pending);});
test('access-denied capture is not retained as an uncertain retry',async()=>{const f=setup();await f.connect();f.control.override=(p,i)=>i.method==='POST'?Response.json({error:{message:'Denied'}},{status:403}):undefined;await assert.rejects(f.client.capture(target));assert.equal(f.client.pending,null);});
test('confirmed save followed by failed history reload is not resubmitted',async()=>{const f=setup();await f.connect();f.control.override=p=>p.includes('github-observations?')?Response.json({error:{message:'Down'}},{status:503}):undefined;await assert.rejects(f.client.capture(target),e=>e.code==='SAVED_REFRESH_FAILED');assert.equal(f.client.pending,null);assert.equal(f.control.commits,1);});
test('project/organization mismatch in detail is never displayed',async()=>{const f=setup();await f.connect();f.control.override=p=>p.endsWith('/'+R)?Response.json({...f.record(),orgId:K}):undefined;await assert.rejects(f.client.open(R),e=>e.code==='INVALID_RESPONSE');assert.equal(f.client.selected,null);});
test('forged readiness effect and artifact attestation are rejected',async()=>{const f=setup();await f.connect();f.control.override=p=>p.endsWith('/'+R)?Response.json({...f.record(),observation:{...f.record().observation,artifactVerified:true}}):undefined;await assert.rejects(f.client.open(R),e=>e.code==='INVALID_RESPONSE');});
test('denied record read clears previously loaded summaries',async()=>{const f=setup();await f.connect();await f.client.capture(target);f.control.override=p=>p.endsWith('/'+R)?Response.json({error:{message:'Revoked'}},{status:404}):undefined;await assert.rejects(f.client.open(R));assert.deepEqual(f.client.rows,[]);assert.equal(f.client.selected,null);});
test('duplicate rows and forged pagination cursor are rejected',async()=>{const f=setup();await f.connect();const r={...f.record(),readinessEffect:'none'};f.control.override=()=>Response.json({orgId:O,projectId:P,observations:[r,r],next:null});await assert.rejects(f.client.history(),e=>e.code==='INVALID_RESPONSE');f.control.override=()=>Response.json({orgId:O,projectId:P,observations:[r],next:K});await assert.rejects(f.client.history(),e=>e.code==='INVALID_RESPONSE');});
test('late record response after context reset does not repopulate history',async()=>{const f=setup();await f.connect();let release;f.control.override=p=>p.endsWith('/'+R)?new Promise(resolve=>{release=resolve;}):undefined;const old=f.client.open(R).catch(e=>e);await new Promise(r=>setImmediate(r));f.client.clear();f.workspace.generation++;release(Response.json(f.record()));assert.equal((await old).code,'STALE_CONTEXT');assert.equal(f.client.selected,null);});
test('session expiry clears retained journal data and uncertain writes',async()=>{const f=setup();await f.connect();await f.client.capture(target);f.control.override=()=>Response.json({error:{message:'Expired'}},{status:401});await assert.rejects(f.client.history(),e=>e.status===401);assert.equal(f.client.selected,null);assert.deepEqual(f.client.rows,[]);assert.equal(f.workspace.authenticated,false);});
test('historical record is retained with explicit current-revision mismatch',async()=>{const f=setup();await f.connect();await f.client.capture(target);f.control.revision=4;await f.client.open(R);assert.equal(f.client.selected.matchesCurrentRevision,false);assert.equal(f.client.selected.projectRevision,2);});
test('collection validates build and numeric target before request',async()=>{const f=setup();await f.connect();const before=f.control.calls.length;for(const bad of [{buildId:'other'},{runId:'0'},{attempt:'1001'},{runId:'x'}])await assert.rejects(f.client.capture({...target,...bad}));assert.equal(f.control.calls.length,before);});
test('concurrent retry cannot send a second in-flight POST',async()=>{const f=setup();await f.connect();let release;f.control.override=(p,i)=>i.method==='POST'?new Promise(resolve=>{release=resolve;}):undefined;const save=f.client.capture(target).catch(e=>e);await new Promise(r=>setImmediate(r));await assert.rejects(f.client.retry(),e=>e.code==='CAPTURE_BUSY');f.client.clear();f.workspace.generation++;release(Response.json({}));assert.equal((await save).code,'STALE_CONTEXT');});
