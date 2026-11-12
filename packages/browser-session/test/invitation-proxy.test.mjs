import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, env, requestId } from './support/fixtures.mjs';
import { browserConfig } from '../src/config.mjs';
const path='/api/browser/api/me/invitations/accept';
test('invitation acceptance uses existing session, CSRF and stable request ID with no client identity overrides',async()=>{
 const f=fixture();const login=await f.login();
 const r=await f.post(path,login.sessionCookie,{code:'nvi1.test'},{'x-navyix-csrf':login.details.csrfToken,'idempotency-key':requestId});
 assert.equal(r.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.headers.authorization,'Bearer server-only-token');
 assert.equal(f.calls[0].init.body,JSON.stringify({code:'nvi1.test'}));
});
test('missing session or CSRF prevents invitation forwarding',async()=>{
 const f=fixture();assert.equal((await f.post(path,'',{code:'test'})).status,401);
 const l=await f.login();assert.equal((await f.post(path,l.sessionCookie,{code:'test'})).status,403);assert.equal(f.calls.length,0);
});
test('recipient token is never accepted through a GET URL',async()=>{
 const f=fixture();const l=await f.login();assert.equal((await f.req(path+'?code=secret',{headers:{cookie:l.sessionCookie}})).status,405);assert.equal(f.calls.length,0);
});
test('email scope is opt-in and cannot be enabled by request input',()=>{
 assert.equal(browserConfig(env).invitationEmail,false);assert.equal(browserConfig({...env,NAVYIX_INVITATIONS_ENABLED:'true'}).invitationEmail,true);
 assert.throws(()=>browserConfig({...env,NAVYIX_INVITATIONS_ENABLED:'yes'}));
});
