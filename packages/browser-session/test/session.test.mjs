import test from 'node:test';
import assert from 'node:assert/strict';
import { browserConfig } from '../src/config.mjs';
import { seal, unseal, challenge, randomToken, equal } from '../src/crypto.mjs';
import { fixture, env, org, project, requestId } from './support/fixtures.mjs';

for (const field of ['NAVYIX_PUBLIC_ORIGIN','NAVYIX_API_ORIGIN','OIDC_ISSUER','OIDC_JWKS_URL','NAVYIX_OIDC_AUTHORIZATION_URL','NAVYIX_OIDC_TOKEN_URL']) {
  for (const bad of ['http://evil.test','https://user:password@identity.test','https://identity.test/#fragment','https://identity.test/?override=yes']) {
    test(`${field} rejects ${bad}`, () => assert.throws(() => browserConfig({ ...env, [field]: bad })));
  }
}
test('production rejects loopback HTTP even when development flag is set', () => assert.throws(() => browserConfig({ ...env, NODE_ENV:'production', NAVYIX_ALLOW_HTTP_LOOPBACK:'true', NAVYIX_PUBLIC_ORIGIN:'http://127.0.0.1:3000' })));
test('explicit development loopback uses different non-Secure cookie names', () => {
  const c=browserConfig({ ...env, NODE_ENV:'development', NAVYIX_ALLOW_HTTP_LOOPBACK:'true', NAVYIX_PUBLIC_ORIGIN:'http://127.0.0.1:3000' }); assert.equal(c.sessionCookie,'navyix-dev-session'); assert.equal(c.secure,false);
});
for (const key of ['', 'abc', 'g'.repeat(64)]) test(`invalid session key ${key.length}`, () => assert.throws(() => browserConfig({ ...env, NAVYIX_SESSION_KEY:key })));
test('PKCE S256 matches RFC 7636 vector', () => assert.equal(challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
test('session entropy and Unicode-safe equality', () => { assert.match(randomToken(), /^[\w-]{43}$/); assert.notEqual(randomToken(),randomToken()); assert.equal(equal('a','é'),false); assert.equal(equal(null,''),false); });
test('real AES-GCM authenticates record context and rejects modification', () => {
  const key=Buffer.from(env.NAVYIX_SESSION_KEY,'hex'), value=seal({ accessToken:'sensitive' },key,'session/a');
  assert.ok(!value.includes('sensitive')); assert.deepEqual(unseal(value,key,'session/a'),{accessToken:'sensitive'});
  assert.throws(()=>unseal(value,key,'session/b')); assert.throws(()=>unseal(value,Buffer.alloc(32),'session/a'));
  const parts=value.split('.'); parts[3]=(parts[3][0]==='a'?'b':'a')+parts[3].slice(1); assert.throws(()=>unseal(parts.join('.'),key,'session/a'));
});
test('login uses POST, PKCE, nonce and secure HttpOnly cookie', async () => {
  const f=fixture(), s=await f.start(); assert.equal(s.response.status,303);
  for (const name of ['state','nonce','code_challenge']) assert.match(s.location.searchParams.get(name),/^[\w-]{43}$/);
  assert.equal(s.location.searchParams.get('code_challenge_method'),'S256'); assert.equal(s.location.searchParams.get('response_type'),'code');
  assert.equal(s.location.searchParams.get('redirect_uri'),'https://navyix.test/api/browser/callback');
  assert.match(s.response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal((await f.req('/api/browser/login')).status,405);
});
test('login denies foreign and absent Origin', async () => {
  const f=fixture(); assert.equal((await f.req('/api/browser/login',{method:'POST'})).status,403);
  assert.equal((await f.post('/api/browser/login','',{}, {origin:'https://other.test'})).status,403);
  assert.equal((await f.post('/api/browser/login','',{}, {'sec-fetch-site':'cross-site'})).status,403);
});
test('complete login, proxy, server-only token and logout cycle', async () => {
  const f=fixture(), s=await f.login(); assert.equal(s.response.status,303); assert.equal(s.response.headers.get('location'),'https://navyix.test/workspace');
  assert.equal(s.details.authenticated,true); assert.ok(!JSON.stringify(s.details).includes('server-only-token'));
  assert.ok(!JSON.stringify([...f.store.sessions.values()]).includes('server-only-token'));
  const response=await f.post(`/api/browser/api/orgs/${org}/projects/${project}/commands`,s.sessionCookie,{type:'test.add'}, {'x-navyix-csrf':s.details.csrfToken,'idempotency-key':requestId});
  assert.equal(response.status,200); assert.equal(f.calls[0].init.headers.authorization,'Bearer server-only-token');
  assert.equal(f.calls[0].init.headers.cookie,undefined); assert.equal(f.calls[0].init.headers['x-navyix-csrf'],undefined);
  assert.equal(f.calls[0].url,`https://api.navyix.test/v1/orgs/${org}/projects/${project}/commands`);
  assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal((await f.post('/api/browser/logout',s.sessionCookie,{}, {'x-navyix-csrf':s.details.csrfToken})).status,200);
  assert.equal((await f.req('/api/browser/session',{headers:{cookie:s.sessionCookie}})).status,401);
});
test('callback is single-use across repeated and simultaneous requests', async () => {
  const f=fixture(), s=await f.login();
  const responses=await Promise.all([f.req(s.callback,{headers:{cookie:s.loginCookie}}),f.req(s.callback,{headers:{cookie:s.loginCookie}})]);
  responses.forEach(r=>assert.match(r.headers.get('location'),/login=failed$/)); assert.equal(f.exchanges.length,1);
});
for (const mode of ['wrong-cookie','expired','duplicate-state','wrong-issuer','cancelled']) test(`callback rejects ${mode}`,async()=>{
  const f=fixture(),s=await f.start(); let path=`/api/browser/callback?state=${s.location.searchParams.get('state')}&code=code`, c=s.loginCookie;
  if(mode==='wrong-cookie') c=`${f.config.loginCookie}=${randomToken()}`;
  if(mode==='expired')f.advance(601000);
  if(mode==='duplicate-state')path+='&state=other';
  if(mode==='wrong-issuer')path+='&iss=https://other.test';
  if(mode==='cancelled')path+='&error=access_denied';
  const r=await f.req(path,{headers:{cookie:c}});assert.match(r.headers.get('location'),/login=failed$/);assert.equal(f.exchanges.length,0);
});
test('new sign-in rotates and revokes previous session',async()=>{
  const f=fixture(),old=await f.login(),s=await f.start();
  await f.req(`/api/browser/callback?state=${s.location.searchParams.get('state')}&code=code`,{headers:{cookie:`${s.loginCookie}; ${old.sessionCookie}`}});
  assert.equal((await f.req('/api/browser/session',{headers:{cookie:old.sessionCookie}})).status,401);
});
for (const mode of ['idle','absolute']) test(`${mode} expiry clears browser authentication`,async()=>{
  const f=fixture(),s=await f.login();
  if(mode==='idle')f.advance(901000);else{f.advance(800000);await f.req('/api/browser/session',{headers:{cookie:s.sessionCookie}});f.advance(800000);await f.req('/api/browser/session',{headers:{cookie:s.sessionCookie}});f.advance(201000);}
  const r=await f.req('/api/browser/session',{headers:{cookie:s.sessionCookie}});assert.equal(r.status,401);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
});
for(const csrf of ['', 'wrong', 'é'.repeat(43)]) test(`mutation rejects invalid CSRF length ${csrf.length}`,async()=>{
  const f=fixture(),s=await f.login();const r=await f.post(`/api/browser/api/orgs/${org}/projects`,s.sessionCookie,{}, {'x-navyix-csrf':csrf,'idempotency-key':requestId});assert.equal(r.status,403);assert.equal(f.calls.length,0);
});
test('duplicate session cookies are rejected',async()=>{const f=fixture(),s=await f.login();assert.equal((await f.req('/api/browser/session',{headers:{cookie:`${s.sessionCookie}; ${s.sessionCookie}`}})).status,401);});
for(const path of ['/api/browser/api/https://evil.test','/api/browser/api/v1/admin',`/api/browser/api/orgs/${org}/projects?url=https://evil.test`,`/api/browser/api/orgs/${org}/projects?limit=20&limit=30`])test(`proxy rejects unapproved target ${path}`,async()=>{const f=fixture(),s=await f.login();const r=await f.req(path,{headers:{cookie:s.sessionCookie}});assert.ok([400,404].includes(r.status));assert.equal(f.calls.length,0);});
test('inbound bearer header is never accepted',async()=>{const f=fixture();assert.equal((await f.req('/api/browser/session',{headers:{authorization:'Bearer supplied'}})).status,400);});
test('forged public Host is rejected',async()=>{const f=fixture();const r=await f.handle(new Request('https://evil.test/api/browser/session'));assert.equal(r.status,400);});
test('valid read proxy cannot forward upstream cookies or redirect headers',async()=>{
 const f=fixture({fetcher:async()=>Response.json({ok:true},{headers:{'set-cookie':'upstream=bad','location':'https://evil.test','cache-control':'public'}})}),s=await f.login();
 const r=await f.req(`/api/browser/api/orgs/${org}/projects`,{headers:{cookie:s.sessionCookie}});assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('backend 401 revokes the browser session',async()=>{
 const f=fixture({fetcher:async()=>Response.json({error:{}},{status:401})}),s=await f.login();
 assert.equal((await f.req(`/api/browser/api/orgs/${org}/projects`,{headers:{cookie:s.sessionCookie}})).status,401);assert.equal(f.store.sessions.size,0);
});
test('backend network failure returns generic error without provider details',async()=>{
 const f=fixture({fetcher:async()=>{throw new Error('password=do-not-leak');}}),s=await f.login();
 const r=await f.req(`/api/browser/api/orgs/${org}/projects`,{headers:{cookie:s.sessionCookie}});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('password'));
});
test('body and content-type limits are enforced before upstream dispatch',async()=>{
 const f=fixture(),s=await f.login(),path=`/api/browser/api/orgs/${org}/projects`,h={'x-navyix-csrf':s.details.csrfToken,'idempotency-key':requestId};
 assert.equal((await f.post(path,s.sessionCookie,'{"text":"'+ 'a'.repeat(1000000)+'"}',h)).status,413);
 assert.equal((await f.post(path,s.sessionCookie,'invalid-json',h)).status,400);
 assert.equal((await f.post(path,s.sessionCookie,{}, {...h,'content-type':'text/plain'})).status,415);assert.equal(f.calls.length,0);
});
