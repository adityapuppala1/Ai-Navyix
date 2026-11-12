import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { InvitationService, invitationCode } from '../src/invitations.mjs';
import { invitationEmail, invitationConfig, InvitationIdentity } from '../src/invitation-identity.mjs';
import { PrismaInvitationRepository } from '../src/invitation-repository.mjs';
const org = '11111111-1111-4111-8111-111111111111', request = '22222222-2222-4222-8222-222222222222';
const actor = { issuer: 'https://issuer.example', subject: 'subject' }, key = Buffer.alloc(32, 17);
const token = 'Bearer header.payload.signature';
function fixture() {
  const calls = [], identityCalls = [];
  const repository = { execute: async (...args) => { calls.push(args); return { orgId: args[2], invitationId: org, requestId: args[4], tokenHash: args[3].tokenHash }; } };
  const identity = { verify: async (...args) => { identityCalls.push(args); return { ...actor, email: 'Person@example.com' }; } };
  return { calls, identityCalls, repository, identity, service: new InvitationService(repository, { key, identity }) };
}
test('creation hashes a deterministic secret code, omits it from persistence and strips the stored hash from the response', async () => {
  const { service, calls } = fixture(); const input = { email: 'Person@EXAMPLE.com', role: 'VIEWER' };
  const a = await service.create(actor, org, input, request), b = await service.create(actor, org, input, request);
  assert.equal(a.code, b.code); assert.equal(a.code.length, 48); assert.equal(a.tokenHash, undefined);
  assert.equal(calls[0][3].tokenHash, createHash('sha256').update(a.code).digest('hex'));
  assert.equal(calls[0][3].email, 'Person@example.com'); assert.equal(calls[0][3].hours, 24);
  assert.ok(!JSON.stringify(calls).includes(a.code)); assert.equal(invitationCode(a.code), a.code);
});
test('codes are different for request, identity, scope and requested permission', async () => {
  const { service } = fixture(), input = { email: 'Person@example.com', role: 'VIEWER' };
  const codes = [await service.create(actor, org, input, request), await service.create(actor, org, input, randomUUID()),
    await service.create({ ...actor, subject: 'other' }, org, input, request), await service.create(actor, randomUUID(), input, request),
    await service.create(actor, org, { ...input, role: 'REVIEWER' }, request)];
  assert.equal(new Set(codes.map(x => x.code)).size, 5);
});
test('recipient identity comes from UserInfo and only hashes enter the database operation', async () => {
  const f = fixture(); const created = await f.service.create(actor, org, { email: 'Person@example.com', role: 'VIEWER' }, request);
  await f.service.accept(actor, token, { code: created.code }, randomUUID());
  assert.deepEqual(f.identityCalls[0], [actor, token]);
  assert.equal(f.calls.at(-1)[0].email, 'Person@example.com'); assert.equal(f.calls.at(-1)[1], 'accept'); assert.equal(f.calls.at(-1)[2], null);
  assert.ok(!JSON.stringify(f.calls.at(-1)).includes(created.code));
});
test('client identity fields and privilege escalation are rejected before any database work', async () => {
  for (const input of [{email:'a@example.com',role:'OWNER'},{email:'a@example.com',role:'ADMIN'},
    {email:'a@example.com',role:'VIEWER',userId:org},{email:'a@example.com',role:'VIEWER',active:true},
    {email:'a@example.com',role:'VIEWER',hours:0},{email:'a@example.com',role:'VIEWER',hours:73}]) {
    const f=fixture(); await assert.rejects(f.service.create(actor,org,input,request),e=>e.status===400);assert.equal(f.calls.length,0);
  }
});
test('recipient proof mismatch or unverified identity cannot reach the database', async () => {
  for (const proof of [{...actor,subject:'other',email:'Person@example.com'},{...actor,issuer:'https://other.example',email:'Person@example.com'}]) {
    const f=fixture();f.identity.verify=async()=>proof;
    await assert.rejects(f.service.accept(actor,token,{code:'nvi1.'+Buffer.alloc(32,1).toString('base64url')},request),e=>e.status===403);
    assert.equal(f.calls.length,0);
  }
});
test('email local parts retain case, dots and plus-tags; unsupported addresses fail closed', () => {
  assert.equal(invitationEmail('A.b+tag@EXAMPLE.com'),'A.b+tag@example.com');
  for (const email of [' a@example.com','a@example.com ','a..b@example.com','a@localhost','a@-bad.example','a@example.com\n','ü@example.com','a@@example.com']) assert.throws(()=>invitationEmail(email));
});
test('canonical base64 encoding prevents alternative spellings for one token',()=>{
  const code='nvi1.'+Buffer.alloc(32,0).toString('base64url'); assert.equal(invitationCode(code),code);
  assert.throws(()=>invitationCode(code.slice(0,-1)+'B')); assert.throws(()=>invitationCode(code+'='));
});
test('key rotation does not pretend a new code matches an old persisted invitation',async()=>{
  const f=fixture();f.repository.execute=async()=>({tokenHash:'f'.repeat(64)});
  await assert.rejects(f.service.create(actor,org,{email:'a@example.com',role:'VIEWER'},request),e=>e.code==='INVITATION_REISSUE_REQUIRED');
});
test('preview and acceptance require code-only input and a request identifier',async()=>{
  const f=fixture();for(const value of [{code:'x',email:'Person@example.com'},{code:'x',role:'OWNER'},{}])await assert.rejects(f.service.preview(actor,token,value,request),e=>e.status===400);
  assert.equal(f.identityCalls.length,0);assert.equal(f.calls.length,0);
});
test('repository binds identity values, serializes writes and maps known database failures without leaking SQL',async()=>{
  const calls=[];let settings;
  const db={$queryRawUnsafe:async(...a)=>{calls.push(a);return[{result:{ok:true}}];}};
  const repo=new PrismaInvitationRepository({$transaction:async(fn,options)=>{settings=options;return fn(db);}});
  const principal={...actor,subject:"subject'; DROP TABLE x;--",email:'Person@example.com'};
  assert.deepEqual(await repo.execute(principal,'accept',null,{tokenHash:'a'.repeat(64)},request),{ok:true});
  assert.equal(settings.isolationLevel,'Serializable');assert.ok(!calls[0][0].includes(principal.subject));
  assert.deepEqual(calls[0].slice(1),[actor.issuer,principal.subject,'','Person@example.com']);
  assert.match(calls[1][0],/\$1,\$2::uuid,\$3::jsonb,\$4::uuid/);
  for(const [code,status] of [['42501',404],['23505',409],['40001',409],['54000',409],['22023',400]]){
    const bad=new PrismaInvitationRepository({$transaction:async()=>{throw{code:'P2010',meta:{code},message:'private SQL'};}});
    await assert.rejects(bad.execute(actor,'accept',null,{},request),e=>e.status===status&&!e.message.includes('private'));
  }
});
const configEnv={NAVYIX_INVITATIONS_ENABLED:'true',NAVYIX_API_ENABLED:'true',OIDC_ISSUER:actor.issuer,NAVYIX_INVITATION_USERINFO_URL:'https://identity.example/userinfo',NAVYIX_INVITATION_KEY:key.toString('hex')};
test('configuration is explicitly enabled, HTTPS-only and uses a key separate from sessions',()=>{
  assert.equal(invitationConfig({}),null);assert.equal(invitationConfig(configEnv).issuer,actor.issuer);
  for(const extra of [{NAVYIX_API_ENABLED:'false'},{NAVYIX_INVITATIONS_ENABLED:'yes'},{NAVYIX_INVITATION_USERINFO_URL:'http://example.com'},{NAVYIX_INVITATION_USERINFO_URL:'https://u:p@example.com'},{NAVYIX_SESSION_KEY:key.toString('hex')}])assert.throws(()=>invitationConfig({...configEnv,...extra}));
});
function identityFixture(value, options={}) {
  const calls=[];
  const verify=new InvitationIdentity(invitationConfig(configEnv),{fetcher:async(...a)=>{calls.push(a);return value instanceof Response?value:Response.json(value);},...options});
  return{verify,calls};
}
test('verified UserInfo requires matching subject and boolean email_verified; transport is fixed and redacted',async()=>{
  const{verify,calls}=identityFixture({sub:actor.subject,email:'Person@EXAMPLE.com',email_verified:true,groups:['admin']});
  assert.deepEqual(await verify.verify(actor,token),{...actor,email:'Person@example.com'});
  assert.equal(calls[0][0],configEnv.NAVYIX_INVITATION_USERINFO_URL);assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].redirect,'error');
  assert.equal(calls[0][1].headers.authorization,token);
});
for(const value of [{sub:actor.subject,email:'Person@example.com',email_verified:false},{sub:actor.subject,email:'Person@example.com',email_verified:'true'},
  {sub:'other',email:'Person@example.com',email_verified:true},{sub:actor.subject,email:'bad',email_verified:true}])
  test('rejects untrusted recipient proof '+JSON.stringify(value),async()=>await assert.rejects(identityFixture(value).verify.verify(actor,token),e=>e.status===403));
test('provider errors, redirects, malformed JSON, oversize and invalid UTF-8 never create a proof',async()=>{
  const replies=[new Response('sensitive',{status:302,headers:{location:'https://evil.example'}}),new Response('sensitive',{status:500}),
    new Response('{bad',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(32769),{headers:{'content-type':'application/json'}}),
    new Response(new Uint8Array([0xc3,0x28]),{headers:{'content-type':'application/json'}})];
  for(const response of replies)await assert.rejects(identityFixture(response).verify.verify(actor,token),e=>e.status===503&&!e.message.includes('sensitive'));
});
test('repeated identity verification uses bounded per-process backoff',async()=>{
  let now=0;const f=identityFixture({sub:actor.subject,email:'Person@example.com',email_verified:true},{clock:()=>now});
  await f.verify.verify(actor,token);await assert.rejects(f.verify.verify(actor,token),e=>e.status===429);assert.equal(f.calls.length,1);
  now=1001;await f.verify.verify(actor,token);assert.equal(f.calls.length,2);
});
test('userinfo never starts a request for another issuer or a malformed access token',async()=>{
  const f=identityFixture({});await assert.rejects(f.verify.verify({...actor,issuer:'other'},token));await assert.rejects(f.verify.verify(actor,'forged'));
  assert.equal(f.calls.length,0);
});
test('a stalled UserInfo stream is bounded even if its cancellation hook stalls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let cancelled=false;
 const response=new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>{cancelled=true;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
 const f=identityFixture(response);const result=assert.rejects(f.verify.verify(actor,token),e=>e.status===503);
 await new Promise(r=>setImmediate(r));t.mock.timers.tick(5000);await result;assert.equal(cancelled,true);assert.equal(f.verify.active,0);
});
test('per-process identity verification does not exceed four concurrent requests',async()=>{
 const releases=[];const verifier=new InvitationIdentity(invitationConfig(configEnv),{fetcher:()=>new Promise(r=>releases.push(r))});
 const waits=Array.from({length:4},(_,n)=>verifier.verify({...actor,subject:'person-'+n},token));
 await assert.rejects(verifier.verify({...actor,subject:'fifth'},token),e=>e.status===429);
 for(let n=0;n<4;n++)releases[n](Response.json({sub:'person-'+n,email:'person'+n+'@example.com',email_verified:true}));
 await Promise.all(waits);assert.equal(verifier.active,0);
});
