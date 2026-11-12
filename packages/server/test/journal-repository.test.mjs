import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrismaEvidenceJournalRepository } from '../src/evidence-journal-repository.mjs';
const role={rolsuper:false,rolbypassrls:false,member:true,security:'on',owner:false};
const table={protected:true,readable:true,mutable:false};
for(const [key,value] of [['rolsuper',true],['rolbypassrls',true],['owner',true],['member',false],['security','off']])test(`journal startup rejects unsafe role ${key}`,async()=>{
 const repo=new PrismaEvidenceJournalRepository({$queryRawUnsafe:async()=>[{...role,[key]:value}]});await assert.rejects(repo.assertRuntime());
});
for(const field of ['protected','readable','mutable'])test(`journal startup verifies ${field} grant/protection`,async()=>{
 let n=0;const repo=new PrismaEvidenceJournalRepository({$queryRawUnsafe:async()=>[++n===1?role:{...table,[field]:!table[field]}]});await assert.rejects(repo.assertRuntime());
});
test('safe role and table pass the startup contract',async()=>{let n=0;await new PrismaEvidenceJournalRepository({$queryRawUnsafe:async()=>[++n===1?role:table]}).assertRuntime();});
test('all untrusted data stays in bound parameters and transaction context is local',async()=>{
 const calls=[];let options;
 const db={$queryRawUnsafe:async(sql,...values)=>{calls.push({sql,values});if(sql.includes('count(*)'))return[{count:0}];return[];},$executeRawUnsafe:async(sql,...values)=>{calls.push({sql,values});return 1;}};
 const prisma={$transaction:async(fn,o)=>{options=o;return fn(db);}},repo=new PrismaEvidenceJournalRepository(prisma);
 const input="malicious' OR 1=1 --";
 await repo.transaction({principal:{issuer:input,subject:input},orgId:input},async tx=>{
  await tx.actor();await tx.projectMembership(input,input);await tx.project(input);await tx.project(input,true);await tx.count(input);await tx.receipt(input,input);
  await tx.saveReceipt(input,input,input,{x:input});const record={id:input,projectId:input,actorId:input,requestId:input,projectRevision:1,recordedAt:'2026-11-12T00:00:00Z',recordSha256:input,observation:{x:input}};
  await tx.insert(record);await tx.audit(record,input);await tx.get(input,input);await tx.list(input,null,20);
 });
 assert.equal(options.isolationLevel,'Serializable');assert.match(calls[0].sql,/set_config\('navyix.issuer',\$1,true\)/);
 for(const call of calls){assert.ok(!call.sql.includes(input));assert.ok(call.values.some(v=>typeof v==='string'&&v.includes(input)));}
 assert.ok(calls.some(c=>c.sql.includes('FOR UPDATE')));assert.ok(calls.some(c=>c.sql.includes('FOR SHARE OF u,m,o')));
});
const migration=readFileSync(new URL('../../../apps/api/prisma/migrations/202611120004_evidence_journal/migration.sql',import.meta.url),'utf8');
test('migration is additive, transactional, forced RLS, with no mutable runtime grants',()=>{
 assert.match(migration,/BEGIN;/);assert.match(migration,/COMMIT;/);assert.match(migration,/ENABLE ROW LEVEL SECURITY/);assert.match(migration,/FORCE ROW LEVEL SECURITY/);
 assert.match(migration,/GRANT SELECT,INSERT/);assert.ok(!/GRANT\s+(UPDATE|DELETE|ALL)/.test(migration));assert.ok(!/DROP\s+(TABLE|SCHEMA)/.test(migration));
});
test('migration blocks missing JSON fields and falsely asserted readiness',()=>{assert.match(migration,/COALESCE\(/);assert.match(migration,/false\)\)/);assert.match(migration,/artifactVerified'='false'/);assert.match(migration,/testCoverageVerified'='false'/);assert.match(migration,/readinessEffect'='none'/);});
test('migration enforces tenant-aware relationships and actor identity',()=>{assert.match(migration,/FOREIGN KEY \("orgId","projectId"\)/);assert.match(migration,/FOREIGN KEY \("orgId","actorId"\)/);assert.match(migration,/"actorId"=public.navyix_actor_id\(\)/);assert.match(migration,/m.role IN \('OWNER','ADMIN','CONTRIBUTOR'\)/);assert.match(migration,/p.role IN \('OWNER','ADMIN','CONTRIBUTOR'\)/);});
