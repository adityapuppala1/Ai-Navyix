import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/fixtures.mjs';
const path = '/api/browser/api/me/organizations';

test('organization GET uses the existing cookie session and keeps the token server-side', async () => {
  const calls=[];
  const f=fixture({fetcher:async(url,init)=>{calls.push({url,init});return Response.json({organizations:[],next:null});}});
  const login=await f.login();
  const response=await f.req(path+'?limit=20',{headers:{cookie:login.sessionCookie}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{organizations:[],next:null});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.navyix.test/v1/me/organizations?limit=20');
  assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.headers.authorization,'Bearer server-only-token');
  assert.equal(calls[0].init.body,undefined);assert.equal(response.headers.get('authorization'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('unsigned directory read never contacts the backend',async()=>{
 const f=fixture();assert.equal((await f.req(path)).status,401);assert.equal(f.calls.length,0);
});
test('expired directory session cannot enumerate organizations',async()=>{
 const f=fixture();const l=await f.login();f.advance(3600000);
 assert.equal((await f.req(path,{headers:{cookie:l.sessionCookie}})).status,401);assert.equal(f.calls.length,0);
});
test('deleted session cannot enumerate organizations',async()=>{
 const f=fixture();const l=await f.login();f.store.sessions.clear();
 assert.equal((await f.req(path,{headers:{cookie:l.sessionCookie}})).status,401);assert.equal(f.calls.length,0);
});
for(const query of ['?userId=attacker','?orgId=other','?role=OWNER','?url=https://other.example','?limit=20&limit=20','?after=../other'])
 test('directory proxy rejects '+query,async()=>{
  const f=fixture();const l=await f.login();assert.equal((await f.req(path+query,{headers:{cookie:l.sessionCookie}})).status,400);assert.equal(f.calls.length,0);
 });
test('directory POST is denied even with a valid session and CSRF token',async()=>{
 const f=fixture();const l=await f.login();
 const r=await f.post(path,l.sessionCookie,{}, {'x-navyix-csrf':l.details.csrfToken});assert.equal(r.status,405);assert.equal(f.calls.length,0);
});
test('supplied bearer tokens cannot replace the browser session',async()=>{
 const f=fixture();const l=await f.login();
 assert.equal((await f.req(path,{headers:{cookie:l.sessionCookie,authorization:'Bearer forged'}})).status,400);assert.equal(f.calls.length,0);
});
test('backend unauthorized directory response deletes the browser session',async()=>{
 const f=fixture({fetcher:async()=>Response.json({error:{code:'UNAUTHENTICATED'}},{status:401})});const l=await f.login();
 const r=await f.req(path,{headers:{cookie:l.sessionCookie}});assert.equal(r.status,401);assert.equal(f.store.sessions.size,0);
 assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
});
test('missing backend feature stays unavailable, not an empty invented directory',async()=>{
 const f=fixture({fetcher:async()=>Response.json({error:{code:'NOT_FOUND',message:'Unavailable'}},{status:404})});const l=await f.login();
 const r=await f.req(path,{headers:{cookie:l.sessionCookie}});assert.equal(r.status,404);assert.equal((await r.json()).organizations,undefined);
});
test('upstream failures do not disclose errors or fabricate memberships',async()=>{
 const f=fixture({fetcher:async()=>{throw new Error('postgres://admin:secret@private/db');}});const l=await f.login();
 const r=await f.req(path,{headers:{cookie:l.sessionCookie}});assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret|postgres|private/);
});
test('directory response never forwards upstream cookies',async()=>{
 const f=fixture({fetcher:async()=>Response.json({organizations:[],next:null},{headers:{'set-cookie':'untrusted=yes'}})});const l=await f.login();
 const r=await f.req(path,{headers:{cookie:l.sessionCookie}});assert.equal(r.headers.get('set-cookie'),null);
});
