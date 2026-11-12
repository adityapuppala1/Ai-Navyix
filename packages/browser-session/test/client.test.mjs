import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspace } from '../src/client.mjs';
// Client-only tests need identifiers, not the server session-handler fixture.
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const second='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function fixture(custom) {
 let revision=1;const calls=[];
 const fetcher=async(path,init)=>{
  calls.push({path,init});
  if(custom){const response=await custom(path,init,calls.length);if(response!==undefined)return response;}
  if(path.endsWith('/session'))return Response.json({authenticated:true,csrfToken:'csrf-test',expiresAt:new Date(Date.now()+3600000).toISOString()});
  if(path.endsWith('/logout'))return Response.json({signedOut:true});
  if(init.method==='POST'){revision++;return Response.json({projectId:project,revision,requestId});}
  if(path.includes('/readiness?'))return Response.json({projectId:project,projectRevision:revision,status:'Insufficient evidence',stage:new URL(path,'https://navyix.test').searchParams.get('stage'),environment:'staging',buildId:null,artifactDigest:null,criteria:[],met:0,total:0});
  if(path.includes('limit='))return Response.json({projects:[{id:project,name:'Project'}],next:null});
  return Response.json({id:project,revision,environment:'staging',builds:[]});
 };
 const api=new BrowserWorkspace({fetcher,uuid:()=>requestId});return{api,calls};
}
test('session and workflow reads use cookies, no bearer header or token storage',async()=>{
 const{api,calls}=fixture();await api.init();await api.connect(org);assert.equal(api.project.id,project);
 assert.equal(Object.keys(api.readiness).length,4);for(const call of calls){assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.headers.authorization,undefined);assert.equal(call.init.cache,'no-store');}
});
test('mutation carries CSRF, expected revision and stable idempotency key',async()=>{
 const{api,calls}=fixture();await api.init();await api.connect(org);await api.command('requirement.add',{title:'Example'});
 const call=calls.at(-1);assert.equal(call.init.headers['x-navyix-csrf'],'csrf-test');assert.equal(call.init.headers['idempotency-key'],requestId);assert.equal(JSON.parse(call.init.body).expectedRevision,1);
});
test('network failure retains exact payload and request ID for safe retry',async()=>{
 let failed=false;const{api,calls}=fixture(async(path,init)=>{if(init.method==='POST'&&!failed){failed=true;throw new Error('network');}});
 await api.init();await api.connect(org);await assert.rejects(api.command('requirement.add',{title:'Original'}));assert.ok(api.pending);
 const first=calls.at(-1);await assert.rejects(api.command('requirement.add',{title:'Different'}),e=>e.code==='PENDING_WRITE');
 await assert.rejects(api.connect(second),e=>e.code==='PENDING_WRITE');await assert.rejects(api.load(project),e=>e.code==='PENDING_WRITE');
 await api.retry();const retried=calls.at(-1);assert.equal(retried.init.body,first.init.body);assert.equal(retried.init.headers['idempotency-key'],first.init.headers['idempotency-key']);assert.equal(api.pending,null);
});
test('known revision conflict clears retry state rather than overwriting',async()=>{
 const{api}=fixture(async(path,init)=>init.method==='POST'?Response.json({error:{code:'REVISION_CONFLICT',message:'Reload'}},{status:409}):undefined);
 await api.init();await api.connect(org);await assert.rejects(api.command('requirement.add',{}),e=>e.status===409);assert.equal(api.pending,null);
});
test('unknown upstream error keeps pending write',async()=>{
 const{api}=fixture(async(path,init)=>init.method==='POST'?Response.json({error:{code:'BACKEND_UNAVAILABLE',message:'Retry'}},{status:502}):undefined);
 await api.init();await api.connect(org);await assert.rejects(api.command('requirement.add',{}));assert.ok(api.pending);
});
test('late responses from another organization cannot repopulate current data',async()=>{
 let release;const{api}=fixture(async(path)=>{if(path.includes(`/orgs/${org}/`)&&path.includes('limit='))return new Promise(resolve=>{release=()=>resolve(Response.json({projects:[{id:project,name:'Old tenant'}],next:null}));});});
 await api.init();const old=api.connect(org);await new Promise(r=>setImmediate(r));await api.connect(second);release();await assert.rejects(old,e=>e.code==='STALE_CONTEXT');assert.equal(api.orgId,second);
});
test('permission failure clears previous organization data before loading',async()=>{
 const{api}=fixture(async(path)=>path.includes(`/orgs/${second}/`)?Response.json({error:{code:'NOT_FOUND',message:'Access unavailable'}},{status:404}):undefined);
 await api.init();await api.connect(org);await assert.rejects(api.connect(second));assert.equal(api.project,null);assert.deepEqual(api.projects,[]);
});
test('session expiry clears all loaded data and pending state',async()=>{
 let expire=false;const{api}=fixture(async()=>expire?Response.json({error:{code:'SESSION_EXPIRED'}},{status:401}):undefined);
 await api.init();await api.connect(org);expire=true;await assert.rejects(api.command('test.add',{}));assert.equal(api.authenticated,false);assert.equal(api.project,null);assert.equal(api.pending,null);assert.deepEqual(api.readiness,{});
});
test('server readiness revision mismatch fails without displaying mixed records',async()=>{
 const{api}=fixture(async(path)=>path.includes('/readiness?')?Response.json({projectId:project,projectRevision:99,criteria:[]}):undefined);
 await api.init();await assert.rejects(api.connect(org),e=>e.code==='REVISION_CHANGED');assert.equal(api.project,null);
});
test('acknowledged save with failed refresh cannot become an unconfirmed retry',async()=>{
 let failRead=false;const{api}=fixture(async(path,init)=>failRead&&init.method==='GET'?Response.json({error:{message:'Unavailable'}},{status:503}):undefined);
 await api.init();await api.connect(org);const ack=await api.command('test.add',{});failRead=true;
 await assert.rejects(api.afterSave(ack),e=>e.code==='SAVED_REFRESH_FAILED');assert.equal(api.pending,null);
});
test('logout clears in-memory content after server invalidation',async()=>{const{api}=fixture();await api.init();await api.connect(org);await api.logout();assert.equal(api.authenticated,false);assert.equal(api.orgId,null);assert.deepEqual(api.projects,[]);});
test('invalid organization is rejected before any project request',async()=>{const{api,calls}=fixture();await api.init();await assert.rejects(api.connect('other/../../admin'));assert.equal(calls.length,1);});

// Regression cases: a previous tab/context must never affect the new one.
test('late error from old organization is a stale-context result, not a current permission failure',async()=>{
 let release;
 const{api}=fixture(async(path)=>path.includes(`/orgs/${org}/`)&&path.includes('limit=')?new Promise(resolve=>{release=()=>resolve(Response.json({error:{message:'Old access denied'}},{status:404}));}):undefined);
 await api.init();const old=api.connect(org);const outcome=old.catch(e=>e);await new Promise(r=>setImmediate(r));await api.connect(second);release();
 assert.equal((await outcome).code,'STALE_CONTEXT');assert.equal(api.orgId,second);assert.equal(api.project.id,project);
});
test('a stale write failure cannot erase a newer pending write',async()=>{
 let firstReply,secondReply,posts=0;
 const{api}=fixture(async(path,init)=>init.method==='POST'?new Promise(resolve=>{if(++posts===1)firstReply=resolve;else secondReply=resolve;}):undefined);
 await api.init();await api.connect(org);
 const old=api.command('requirement.add',{title:'Old'}).catch(e=>e);
 await new Promise(r=>setImmediate(r));api.generation++;api.clear();await api.init();await api.connect(second);
 const current=api.command('requirement.add',{title:'Current'});await new Promise(r=>setImmediate(r));const pending=api.pending;
 firstReply(Response.json({error:{message:'Conflict'}},{status:409}));await old;assert.equal(api.pending,pending);
 secondReply(Response.json({projectId:project,revision:2,requestId}));await current;
});
test('an explicit no-build selection survives loading and saving',async()=>{
 const{api}=fixture();await api.init();await api.connect(org);await api.load(project,'');assert.equal(api.buildId,'');
 const ack=await api.command('requirement.add',{});await api.afterSave(ack,'');assert.equal(api.buildId,'');
});
test('same revision but wrong readiness environment is never displayed',async()=>{
 const{api}=fixture(async(path)=>path.includes('/readiness?')?Response.json({projectId:project,projectRevision:1,stage:new URL(path,'https://navyix.test').searchParams.get('stage'),environment:'production',buildId:null,artifactDigest:null,status:'Ready',criteria:[],met:0,total:0}):undefined);
 await api.init();await assert.rejects(api.connect(org),e=>e.code==='INVALID_RESPONSE');assert.equal(api.project,null);
});
test('same revision but wrong readiness stage is never displayed',async()=>{
 const{api}=fixture(async(path)=>path.includes('/readiness?')?Response.json({projectId:project,projectRevision:1,stage:'release',environment:'staging',buildId:null,artifactDigest:null,status:'Ready',criteria:[],met:0,total:0}):undefined);
 await api.init();await assert.rejects(api.connect(org),e=>e.code==='INVALID_RESPONSE');assert.equal(api.project,null);
});
test('malformed or empty session expiration is rejected',async()=>{
 const{api}=fixture(async(path)=>path.endsWith('/session')?Response.json({authenticated:true,csrfToken:'csrf-test',expiresAt:'not-a-date'}):undefined);
 await assert.rejects(api.init(),e=>e.code==='INVALID_SESSION');assert.equal(api.authenticated,false);
});
