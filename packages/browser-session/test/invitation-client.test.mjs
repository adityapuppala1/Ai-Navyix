import test from 'node:test';
import assert from 'node:assert/strict';
import { InvitationClient } from '../src/invitation-client.mjs';
import { invitationProxyTarget } from '../src/invitation-route.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code='nvi1.'+Buffer.alloc(32,1).toString('base64url'),expires=new Date(Date.now()+86400000).toISOString();
const row={id:id(2),email:'user@example.com',role:'VIEWER',status:'pending',createdAt:new Date().toISOString(),expiresAt:expires};
function fixture(custom) {
  const calls=[];let i=10;
  const api={authenticated:true,generation:1,uuid:()=>id(i++),request:async(path,init={})=>{
    calls.push({path,init});if(custom){const value=await custom(path,init);if(value!==undefined)return value;}
    if(path.endsWith('/preview'))return {orgId:id(1),organizationName:'Test Org',role:'VIEWER',expiresAt:expires,alreadyMember:false};
    if(path.endsWith('/accept'))return {orgId:id(1),organizationName:'Test Org',role:'VIEWER',alreadyMember:false,requestId:init.key};
    if(path.endsWith('/revoke'))return {orgId:id(1),invitationId:id(2),status:'revoked',requestId:init.key};
    if(init.method==='POST')return {orgId:id(1),invitationId:id(2),email:init.body.email,role:init.body.role,status:'pending',expiresAt:expires,code,requestId:init.key};
    return {orgId:id(1),invitations:[row],next:null};
  }};return {api,client:new InvitationClient(api),calls};
}
test('creation uses the selected organization, no URL secrets and a stable original retry',async()=>{
 let first=true;const f=fixture(async(path,init)=>{if(init.method==='POST'&&first){first=false;throw new Error('Network');}});
 await f.client.list(id(1));await assert.rejects(f.client.create({email:'user@EXAMPLE.com',role:'VIEWER',hours:24}));
 const original=structuredClone(f.calls.at(-1));assert.ok(f.client.pending);
 await assert.rejects(f.client.list(id(3)),e=>e.code==='PENDING_INVITATION');
 const result=await f.client.retry();assert.equal(result.code,code);assert.deepEqual(f.calls.at(-1),original);
 assert.equal(f.client.pending,null);assert.ok(!original.path.includes('user'));
});
test('malformed acknowledgement retains original retry state',async()=>{
 const f=fixture((path,init)=>init.method==='POST'?{orgId:id(9),requestId:init.key}:undefined);
 await f.client.list(id(1));await assert.rejects(f.client.create({email:'user@example.com',role:'VIEWER',hours:24}),e=>e.code==='INVALID_INVITATION_RESPONSE');assert.ok(f.client.pending);
});
test('known permission/conflict errors clear pending state without resubmission',async()=>{
 for(const status of [403,404,409]){const f=fixture((p,o)=>{if(o.method==='POST')throw Object.assign(new Error('denied'),{status});});
 await f.client.list(id(1));await assert.rejects(f.client.create({email:'a@example.com',role:'VIEWER'}));assert.equal(f.client.pending,null);}
});
test('acceptance requires an explicit reviewed preview and matching response',async()=>{
 const f=fixture();assert.throws(()=>f.client.accept(),e=>e.code==='PREVIEW_REQUIRED');
 await f.client.inspect(code);assert.equal(f.client.preview.organizationName,'Test Org');const r=await f.client.accept();assert.equal(r.orgId,id(1));assert.equal(f.client.preview,null);
 assert.equal(f.calls.at(-1).init.body.code,code);assert.ok(!f.calls.some(x=>x.path.includes(code)));
});
test('an existing membership response may retain an existing owner role but a new membership may not gain one',async()=>{
 for(const existing of [true,false]){
 const f=fixture((p,o)=>p.endsWith('/accept')?{orgId:id(1),organizationName:'Test Org',role:'OWNER',alreadyMember:existing,requestId:o.key}:undefined);
 await f.client.inspect(code);if(existing)assert.equal((await f.client.accept()).role,'OWNER');else await assert.rejects(f.client.accept(),e=>e.code==='INVALID_INVITATION_RESPONSE');
 }
});
test('late lists and acknowledgements cannot repopulate a new session',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const waiting=f.client.list(id(1));f.api.generation++;resolve({orgId:id(1),invitations:[row],next:null});
 await assert.rejects(waiting,e=>e.code==='STALE_CONTEXT');assert.deepEqual(f.client.rows,[]);
});
test('reset removes pending codes and preview data',async()=>{
 const f=fixture();await f.client.inspect(code);f.client.reset();assert.equal(f.client.preview,null);assert.equal(f.client.pending,null);
});
test('invalid directory or foreign-scope rows are not displayed',async()=>{
 for(const data of [{orgId:id(3),invitations:[row],next:null},{orgId:id(1),invitations:[row,row],next:null},{orgId:id(1),invitations:[{...row,role:'OWNER'}],next:null}]){
 const f=fixture(()=>data);await assert.rejects(f.client.list(id(1)),e=>e.code==='INVALID_INVITATION_RESPONSE');assert.deepEqual(f.client.rows,[]);}
});
test('revoke only uses an existing displayed pending invitation',async()=>{
 const f=fixture();await f.client.list(id(1));assert.throws(()=>f.client.revoke(id(99)));const r=await f.client.revoke(id(2));assert.equal(r.kind,'revoke');
});
const url=path=>new URL('https://navyix.test/api/browser/api/'+path);
test('proxy accepts only fixed invitation endpoints and correct methods',()=>{
 assert.equal(invitationProxyTarget(url(`orgs/${id(1)}/invitations?limit=20`),'GET'),`/v1/orgs/${id(1)}/invitations?limit=20`);
 assert.equal(invitationProxyTarget(url('me/invitations/accept'),'POST'),'/v1/me/invitations/accept');
 assert.equal(invitationProxyTarget(url('me/invitations/preview'),'POST'),'/v1/me/invitations/preview');
 assert.equal(invitationProxyTarget(url('me/other'),'POST'),null);
 for(const path of ['me/invitations/preview','me/invitations/accept',`orgs/${id(1)}/invitations/${id(2)}/revoke`])assert.throws(()=>invitationProxyTarget(url(path),'GET'));
});
test('query tokens, arbitrary endpoints and duplicate paging fields are rejected',()=>{
 for(const q of ['token=secret','email=a@example.com','role=OWNER','limit=20&limit=2','after=bad','limit=21'])assert.throws(()=>invitationProxyTarget(url(`orgs/${id(1)}/invitations?${q}`),'GET'));
 assert.throws(()=>invitationProxyTarget(url('me/invitations/accept?code=secret'),'POST'));
});
