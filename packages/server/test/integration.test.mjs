import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { authConfig, createAuthenticator } from '../src/auth.mjs';
import { PrismaWorkflowRepository } from '../src/repository.mjs';
import { WorkflowService } from '../src/service.mjs';
const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const strict = process.env.NAVYIX_REQUIRE_INTEGRATION === '1';
let jose;
try { jose = await import(pathToFileURL(require.resolve('jose')).href); }
catch (error) { if (!['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error; }
test('integration: real JOSE signature verification, token rejection and access-token binding', { skip: !jose && !strict ? 'jose dependency unavailable; cryptographic verification NOT executed' : false }, async () => {
  assert.ok(jose, 'Install the declared jose dependency before this gate.');
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey); jwk.kid='test-key'; jwk.alg='RS256'; jwk.use='sig';
  const cfg=authConfig({OIDC_ISSUER:'https://issuer.example',OIDC_JWKS_URL:'https://issuer.example/keys',OIDC_AUDIENCE:'navyix',OIDC_REQUIRED_SCOPE:'navyix/api'});
  // Only key retrieval is stubbed; the real JOSE verifier checks the signed token.
  const authenticate=createAuthenticator(cfg,{...jose,createRemoteJWKSet:()=>jose.createLocalJWKSet({keys:[jwk]})});
  const sign=(changes={},header={})=>new jose.SignJWT({iss:cfg.issuer,sub:'subject',aud:cfg.audience,scope:cfg.requiredScope,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...changes})
    .setProtectedHeader({alg:'RS256',kid:'test-key',typ:'at+jwt',...header}).sign(privateKey);
  const token=await sign();assert.deepEqual(await authenticate('Bearer '+token),{issuer:cfg.issuer,subject:'subject'});
  for (const changed of [{aud:'wrong'},{iss:'https://other.example'},{exp:Math.floor(Date.now()/1000)-1},{scope:'openid'}])
    await assert.rejects(authenticate('Bearer '+await sign(changed)),e=>e.status===401);
  await assert.rejects(authenticate('Bearer '+await sign({}, {typ:'JWT'})),e=>e.status===401);
  const [head,payload,signature]=token.split('.');
  const modified=signature[0]==='A'?'B':'A';
  await assert.rejects(authenticate(`Bearer ${head}.${payload}.${modified}${signature.slice(1)}`),e=>e.status===401);
});
const live = Boolean(process.env.NAVYIX_TEST_DATABASE_URL && process.env.NAVYIX_TEST_ADMIN_URL && process.env.NAVYIX_TEST_DB_CONFIRM === 'disposable');
test('integration: PostgreSQL runtime-role RLS, persistence, revocation and pooled context isolation', {skip: !live && !strict ? 'Disposable PostgreSQL URLs not configured; live RLS NOT executed' : false}, async () => {
  assert.ok(live, 'Configure only a migrated disposable database; set NAVYIX_TEST_DB_CONFIRM=disposable.');
  const {PrismaClient}=require('@prisma/client');
  const runtimeUrl=new URL(process.env.NAVYIX_TEST_DATABASE_URL);runtimeUrl.searchParams.set('connection_limit','1');
  const admin=new PrismaClient({datasourceUrl:process.env.NAVYIX_TEST_ADMIN_URL});
  const db=new PrismaClient({datasourceUrl:runtimeUrl.href});
  const orgs=[randomUUID(),randomUUID()],users=[randomUUID(),randomUUID()];
  const principals=users.map(subject=>({issuer:'https://integration.example',subject}));
  try {
    const repo=new PrismaWorkflowRepository(db);await repo.assertRuntime();
    for(let i=0;i<2;i++){
      await admin.user.create({data:{id:users[i],oidcIssuer:principals[i].issuer,oidcSubject:principals[i].subject,email:`${users[i]}@example.test`}});
      await admin.organization.create({data:{id:orgs[i],name:'Disposable test',slug:orgs[i]}});
      await admin.membership.create({data:{id:randomUUID(),orgId:orgs[i],userId:users[i],role:'OWNER'}});
    }
    const service=new WorkflowService(repo),input={name:'Test project',goal:'Verify boundaries',owner:'Test'};
    const a=await service.create(principals[0],orgs[0],input,randomUUID());
    const b=await service.create(principals[1],orgs[1],input,randomUUID());
    await service.command(principals[0],orgs[0],a.projectId,{expectedRevision:1,type:'requirement.add',input:{title:'Login',acceptance:'Verified token'}},randomUUID());
    assert.equal((await service.get(principals[0],orgs[0],a.projectId)).revision,2);
    for(let i=0;i<4;i++){
      assert.equal((await service.get(principals[1],orgs[1],b.projectId)).id,b.projectId);
      assert.equal((await service.get(principals[0],orgs[0],a.projectId)).id,a.projectId);
    }
    await assert.rejects(service.get(principals[1],orgs[0],a.projectId),e=>e.status===404);
    const rows=await db.$transaction(async tx=>{
      await tx.$queryRawUnsafe(`SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),set_config('navyix.org_id',$3,true)`,principals[1].issuer,principals[1].subject,orgs[0]);
      return tx.$queryRawUnsafe('SELECT * FROM "WorkflowState"');
    });assert.equal(rows.length,0);
    const [context]=await db.$queryRawUnsafe(`SELECT current_setting('navyix.org_id',true) AS org`);assert.ok(!context.org);
    await admin.membership.update({where:{orgId_userId:{orgId:orgs[0],userId:users[0]}},data:{active:false}});
    await assert.rejects(service.get(principals[0],orgs[0],a.projectId),e=>e.status===404);
    await assert.rejects(db.$executeRawUnsafe('DELETE FROM "WorkflowSnapshot"'));
  } finally {
    // Delete only UUIDs allocated by this test, never truncate shared tables.
    for(const table of ['WorkflowSnapshot','WorkflowCommand','AuditEvent','WorkflowState','ProjectMembership','Project','Membership','Organization']) {
      const column=table==='Organization'?'id':'orgId';
      await admin.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${column}" IN ($1::uuid,$2::uuid)`,...orgs);
    }
    await admin.user.deleteMany({where:{id:{in:users}}});
    await db.$disconnect();await admin.$disconnect();
  }
});
