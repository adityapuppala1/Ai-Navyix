/** Actual SQL/RLS tests when explicitly configured. GitHub responses remain synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID,createHash } from 'node:crypto';
import { EvidenceJournalService } from '../src/evidence-journal.mjs';
import { PrismaEvidenceJournalRepository } from '../src/evidence-journal-repository.mjs';
const strict=process.env.NAVYIX_REQUIRE_INTEGRATION==='1';
const configured=Boolean(process.env.NAVYIX_TEST_DATABASE_URL&&process.env.NAVYIX_TEST_ADMIN_URL&&process.env.NAVYIX_TEST_DB_CONFIRM==='disposable');
test('live PostgreSQL evidence journal: real grants, RLS, persistence, idempotency and history',{skip:!configured&&!strict?'Disposable database not configured; SQL and RLS have NOT executed':false},async t=>{
 assert.ok(configured,'Configure migrated disposable PostgreSQL and NAVYIX_TEST_DB_CONFIRM=disposable.');
 const require=createRequire(new URL('../../../apps/api/package.json',import.meta.url));const {PrismaClient}=require('@prisma/client');
 const url=new URL(process.env.NAVYIX_TEST_DATABASE_URL);url.searchParams.set('connection_limit','1');
 const db=new PrismaClient({datasourceUrl:url.href}),admin=new PrismaClient({datasourceUrl:process.env.NAVYIX_TEST_ADMIN_URL});
 const orgs=[randomUUID(),randomUUID()],users=[randomUUID(),randomUUID()],projects=[randomUUID(),randomUUID()];
 const principals=users.map(subject=>({issuer:'https://journal.integration.test',subject}));
 const project=i=>({id:projects[i],revision:2,builds:[{id:'BLD-001',commitSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),environment:'staging'}]});
 const input={expectedRevision:2,buildId:'BLD-001',runId:'123',attempt:'1'};let calls=0,ack;
 try{
  const repository=new PrismaEvidenceJournalRepository(db);await repository.assertRuntime();
  for(let i=0;i<2;i++){
   await admin.$executeRawUnsafe('INSERT INTO public."User" (id,"oidcIssuer","oidcSubject",email) VALUES ($1::uuid,$2,$3,$4)',users[i],principals[i].issuer,principals[i].subject,`${users[i]}@example.test`);
   await admin.$executeRawUnsafe('INSERT INTO public."Organization" (id,name,slug) VALUES ($1::uuid,$2,$3)',orgs[i],'Disposable journal test',orgs[i]);
   await admin.$executeRawUnsafe('INSERT INTO public."Membership" (id,"orgId","userId",role) VALUES ($1::uuid,$2::uuid,$3::uuid,\'OWNER\')',randomUUID(),orgs[i],users[i]);
   await admin.$executeRawUnsafe('INSERT INTO public."Project" (id,"orgId",name,key) VALUES ($1::uuid,$2::uuid,$3,$4)',projects[i],orgs[i],'Evidence project',projects[i]);
   await admin.$executeRawUnsafe('INSERT INTO public."ProjectMembership" ("orgId","projectId","userId",role) VALUES ($1::uuid,$2::uuid,$3::uuid,\'OWNER\')',orgs[i],projects[i],users[i]);
   await admin.$executeRawUnsafe('INSERT INTO public."WorkflowState" ("orgId","projectId",revision,data) VALUES ($1::uuid,$2::uuid,2,$3::jsonb)',orgs[i],projects[i],JSON.stringify(project(i)));
  }
  const collector={inspect:async(principal,orgId,projectId,target)=>{calls++;const i=projects.indexOf(projectId),b=project(i).builds[0];const observation={schemaVersion:1,kind:'github-run-observation',orgId,projectId,projectRevision:2,target:{buildId:b.id,commitSha:b.commitSha,artifactDigest:b.artifactDigest,environment:b.environment},source:{repository:'example/repo',id:123,attempt:1,commitSha:b.commitSha,url:'https://github.com/example/repo/actions/runs/123/attempts/1'},collectedAt:new Date().toISOString(),summary:'Reported success',jobs:[],criteria:[],artifactVerified:false,testCoverageVerified:false,readinessEffect:'none'};return{...observation,contentSha256:createHash('sha256').update(JSON.stringify(observation)).digest('hex')};}};
  const service=new EvidenceJournalService(repository,collector),requestId=randomUUID();
  await t.test('atomic capture and retry are persisted once',async()=>{
   ack=await service.capture(principals[0],orgs[0],projects[0],input,requestId);
   assert.deepEqual(await service.capture(principals[0],orgs[0],projects[0],input,requestId),ack);assert.equal(calls,1);
   const [counts]=await admin.$queryRawUnsafe('SELECT (SELECT count(*) FROM public."GitHubObservation" WHERE "orgId"=$1::uuid)::int AS observations,(SELECT count(*) FROM public."AuditEvent" WHERE "orgId"=$1::uuid)::int AS audits,(SELECT count(*) FROM public."WorkflowCommand" WHERE "orgId"=$1::uuid)::int AS receipts',orgs[0]);assert.deepEqual(counts,{observations:1,audits:1,receipts:1});
  });
  await t.test('JSONB roundtrip preserves canonical integrity and project binding',async()=>{
   const record=await service.get(principals[0],orgs[0],projects[0],ack.observationId);assert.equal(record.projectRevision,2);assert.equal(record.matchesCurrentRevision,true);assert.equal(record.observation.readinessEffect,'none');
  });
  await t.test('foreign tenant and project accesses fail; direct RLS returns no rows',async()=>{
   await assert.rejects(service.get(principals[1],orgs[0],projects[0],ack.observationId),e=>e.status===404);
   await assert.rejects(service.get(principals[1],orgs[1],projects[1],ack.observationId),e=>e.status===404);
   const rows=await db.$transaction(async tx=>{await tx.$queryRawUnsafe("SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),set_config('navyix.org_id',$3,true)",principals[1].issuer,principals[1].subject,orgs[0]);return tx.$queryRawUnsafe('SELECT * FROM public."GitHubObservation"');});assert.equal(rows.length,0);
   const [ctx]=await db.$queryRawUnsafe("SELECT current_setting('navyix.org_id',true) AS org");assert.ok(!ctx.org);
  });
  await t.test('runtime cannot edit or delete observations',async()=>{
   await assert.rejects(db.$executeRawUnsafe('DELETE FROM public."GitHubObservation"'));await assert.rejects(db.$executeRawUnsafe('UPDATE public."GitHubObservation" SET "projectRevision"=99'));await assert.rejects(db.$executeRawUnsafe('TRUNCATE public."GitHubObservation"'));
  });
  await t.test('project edits leave original history intact',async()=>{
   const revised={...project(0),revision:3};await admin.$executeRawUnsafe('UPDATE public."WorkflowState" SET revision=3,data=$3::jsonb WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid',orgs[0],projects[0],JSON.stringify(revised));
   const saved=await service.get(principals[0],orgs[0],projects[0],ack.observationId);assert.equal(saved.projectRevision,2);assert.equal(saved.matchesCurrentRevision,false);
  });
  await t.test('revocation denies reads and committed-request replay',async()=>{
   await admin.$executeRawUnsafe('UPDATE public."Membership" SET active=false WHERE "orgId"=$1::uuid AND "userId"=$2::uuid',orgs[0],users[0]);
   await assert.rejects(service.list(principals[0],orgs[0],projects[0]),e=>e.status===404);await assert.rejects(service.capture(principals[0],orgs[0],projects[0],input,requestId),e=>e.status===404);
  });
 }finally{
  // Delete only this test's UUIDs. Never reset/truncate a supplied database.
  try{for(const table of ['GitHubObservation','AuditEvent','WorkflowCommand','WorkflowState','ProjectMembership','Project','Membership','Organization']){
   const column=table==='Organization'?'id':'orgId';await admin.$executeRawUnsafe(`DELETE FROM public."${table}" WHERE "${column}" IN ($1::uuid,$2::uuid)`,...orgs);
  }await admin.user.deleteMany({where:{id:{in:users}}});}finally{await db.$disconnect();await admin.$disconnect();}
 }
});
