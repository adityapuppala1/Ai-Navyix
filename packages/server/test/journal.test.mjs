import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EvidenceJournalService, journalHash } from '../src/evidence-journal.mjs';
import { fixture, ORG,PROJECT,OTHER,USER,PRINCIPAL,INPUT } from './support/journal-fixture.mjs';

test('capture persists collected evidence, receipt and audit without changing project/readiness',async()=>{
 const f=fixture(),before=structuredClone(f.state.project),ack=await f.capture();
 assert.equal(f.state.records.length,1);assert.equal(f.state.audits.length,1);assert.equal(Object.keys(f.state.receipts).length,1);
 assert.equal(f.state.records[0].id,ack.observationId);assert.deepEqual(f.state.project,before);assert.equal(f.control.fetches,1);
 assert.equal(f.state.records[0].observation.readinessEffect,'none');assert.equal(f.state.records[0].actorId,USER);
});
test('same request replays a committed capture without a second external collection',async()=>{
 const f=fixture(),key=randomUUID(),a=await f.capture(INPUT,key);f.advance(1000);const b=await f.capture(INPUT,key);
 assert.deepEqual(a,b);assert.equal(f.control.fetches,1);assert.equal(f.state.records.length,1);
});
test('same idempotency identifier cannot capture a different run',async()=>{
 const f=fixture(),key=randomUUID();await f.capture(INPUT,key);await assert.rejects(f.capture({...INPUT,runId:'124'},key),e=>e.code==='IDEMPOTENCY_CONFLICT');
});
for(const role of ['VIEWER','REVIEWER'])test(`${role} can read history but cannot capture`,async()=>{
 const f=fixture(),ack=await f.capture();f.state.actor.role=role;f.state.membership.role=role;
 assert.equal((await f.service.get(PRINCIPAL,ORG,PROJECT,ack.observationId)).id,ack.observationId);
 await assert.rejects(f.capture(),e=>e.status===403);assert.equal(f.control.fetches,1);
});
for(const field of ['active','organizationActive','userActive'])test(`inactive ${field} denies read/write and replay`,async()=>{
 const f=fixture(),key=randomUUID(),ack=await f.capture(INPUT,key);f.state.actor[field]=false;
 await assert.rejects(f.capture(INPUT,key),e=>e.status===404);await assert.rejects(f.service.get(PRINCIPAL,ORG,PROJECT,ack.observationId),e=>e.status===404);
});
test('inactive project member and cross-tenant/project requests are denied before collection',async()=>{
 const f=fixture();f.state.membership.active=false;await assert.rejects(f.capture(),e=>e.status===404);
 f.state.membership.active=true;await assert.rejects(f.capture(INPUT,randomUUID(),PRINCIPAL,OTHER),e=>e.status===404);
 await assert.rejects(f.capture(INPUT,randomUUID(),PRINCIPAL,ORG,OTHER),e=>e.status===404);assert.equal(f.control.fetches,0);
});
test('both organization and project roles restrict writes',async()=>{
 const f=fixture();f.state.membership.role='VIEWER';await assert.rejects(f.capture(),e=>e.status===403);
 f.state.membership.role='OWNER';f.state.actor.role='VIEWER';await assert.rejects(f.capture(),e=>e.status===403);
});
test('missing authenticated principal is rejected',async()=>{const f=fixture();await assert.rejects(f.capture(INPUT,randomUUID(),null),e=>e.status===401);});
for(const extra of [{observation:{}},{actorId:OTHER},{repository:'evil/repo'},{token:'bad'},{expectedRevision:0},{runId:'1e2'},{attempt:'0'},{attempt:'1001'},{buildId:'../../x'}])test(`untrusted request rejected: ${JSON.stringify(extra)}`,async()=>{
 const f=fixture();await assert.rejects(f.capture({...INPUT,...extra}),e=>e.status===400);assert.equal(f.control.fetches,0);
});
test('stale revision and unknown build fail before any external work',async()=>{
 const f=fixture();await assert.rejects(f.capture({...INPUT,expectedRevision:1}),e=>e.status===409);await assert.rejects(f.capture({...INPUT,buildId:'BLD-002'}),e=>e.status===400);assert.equal(f.control.fetches,0);
});
test('revocation while fetching prevents all persistent effects',async()=>{
 const f=fixture();f.control.mutate=()=>{f.state.membership.active=false;};await assert.rejects(f.capture(),e=>e.status===404);assert.equal(f.state.records.length,0);assert.equal(f.state.audits.length,0);
});
test('project edit while fetching prevents stale capture',async()=>{
 const f=fixture();f.control.mutate=()=>{f.state.project.revision++;};await assert.rejects(f.capture(),e=>e.code==='REVISION_CONFLICT');assert.equal(f.state.records.length,0);
});
for(const phase of ['audit','receipt'])test(`${phase} failure rolls back observation and audit`,async()=>{
 const f=fixture();f.control.fail=phase;await assert.rejects(f.capture());assert.equal(f.state.records.length,0);assert.equal(f.state.audits.length,0);assert.deepEqual(f.state.receipts,{});
});
for(const [name,mutate] of [
 ['foreign tenant',o=>o.orgId=OTHER],['foreign project',o=>o.projectId=OTHER],['wrong revision',o=>o.projectRevision=3],
 ['wrong build',o=>o.target.buildId='BLD-002'],['wrong commit',o=>o.target.commitSha='b'.repeat(40)],['wrong artifact',o=>o.target.artifactDigest='sha256:'+'c'.repeat(64)],
 ['wrong environment',o=>o.target.environment='prod'],['wrong run',o=>o.source.id=124],['wrong attempt',o=>o.source.attempt=2],
 ['forged attestation',o=>o.artifactVerified=true],['forged coverage',o=>o.testCoverageVerified=true],['readiness change',o=>o.readinessEffect='approve'],
 ['old observation',o=>o.collectedAt='2020-01-01T00:00:00Z'],['future observation',o=>o.collectedAt='2030-01-01T00:00:00Z'],
 ['external URL',o=>o.source.url='https://evil.test'],['oversized observation',o=>o.padding='x'.repeat(500001)]
])test(`collector output rejected: ${name}`,async()=>{const f=fixture();f.control.mutate=mutate;await assert.rejects(f.capture(),e=>e.code==='INVALID_OBSERVATION');assert.equal(f.state.records.length,0);});
test('invalid collector checksum is rejected',async()=>{
 const f=fixture(),inspect=f.collector.inspect;f.collector.inspect=async(...args)=>({...await inspect(...args),contentSha256:'0'.repeat(64)});await assert.rejects(f.capture(),e=>e.status===502);
});
test('failed job observation is retained as reported failure, never promoted to pass',async()=>{
 const f=fixture();f.control.mutate=o=>{o.summary='Not successful';o.jobs=[{id:5,status:'completed',conclusion:'failure'}];};const a=await f.capture();
 const r=await f.service.get(PRINCIPAL,ORG,PROJECT,a.observationId);assert.equal(r.observation.summary,'Not successful');assert.equal(r.observation.readinessEffect,'none');
});
test('canonical checksum survives JSONB-like key reordering but detects changed content',async()=>{
 const f=fixture(),a=await f.capture();const r=f.state.records[0];r.observation=Object.fromEntries(Object.entries(r.observation).reverse());
 assert.equal(journalHash(r.observation),r.recordSha256);await f.service.get(PRINCIPAL,ORG,PROJECT,a.observationId);
 f.state.records[0].observation.summary='Not successful';await assert.rejects(f.service.get(PRINCIPAL,ORG,PROJECT,a.observationId),e=>e.code==='JOURNAL_INTEGRITY');
 await assert.rejects(f.service.list(PRINCIPAL,ORG,PROJECT),e=>e.code==='JOURNAL_INTEGRITY');
});
test('saved revision remains readable and labeled historical after project changes',async()=>{
 const f=fixture(),a=await f.capture();f.state.project.revision=9;const r=await f.service.get(PRINCIPAL,ORG,PROJECT,a.observationId);
 assert.equal(r.projectRevision,2);assert.equal(r.currentProjectRevision,9);assert.equal(r.matchesCurrentRevision,false);
});
test('newest-first cursor pagination and empty list retain project scope',async()=>{
 const f=fixture();assert.deepEqual((await f.service.list(PRINCIPAL,ORG,PROJECT)).observations,[]);
 const a=await f.capture();f.advance(1000);const b=await f.capture();
 const page=await f.service.list(PRINCIPAL,ORG,PROJECT,{limit:1});assert.equal(page.observations[0].id,b.observationId);assert.equal(page.next,b.observationId);
 const last=await f.service.list(PRINCIPAL,ORG,PROJECT,{limit:1,after:page.next});assert.equal(last.observations[0].id,a.observationId);assert.equal(last.next,null);
});
test('foreign or nonexistent cursors and records cannot be accessed',async()=>{
 const f=fixture();await f.capture();await assert.rejects(f.service.list(PRINCIPAL,ORG,PROJECT,{after:OTHER}),e=>e.status===404);
 await assert.rejects(f.service.get(PRINCIPAL,ORG,PROJECT,OTHER),e=>e.status===404);await assert.rejects(f.service.list(PRINCIPAL,OTHER,PROJECT),e=>e.status===404);
});
for(const limit of [0,21,-1,'20',1.5])test(`invalid page limit ${limit}`,async()=>{const f=fixture();await assert.rejects(f.service.list(PRINCIPAL,ORG,PROJECT,{limit}),e=>e.status===400);});
test('pilot cap prevents new capture but permits retry of last committed request',async()=>{
 const f=fixture(),key=randomUUID(),ack=await f.capture(INPUT,key);const r=f.state.records[0];while(f.state.records.length<100)f.state.records.push({...r,id:randomUUID()});
 assert.deepEqual(await f.capture(INPUT,key),ack);await assert.rejects(f.capture(),e=>e.code==='JOURNAL_LIMIT');assert.equal(f.control.fetches,1);
});
test('disabled collector permits history and replay but not new collection',async()=>{
 const f=fixture(),key=randomUUID(),ack=await f.capture(INPUT,key);const service=new EvidenceJournalService(f.repository,null);
 assert.equal((await service.get(PRINCIPAL,ORG,PROJECT,ack.observationId)).id,ack.observationId);
 assert.deepEqual(await service.capture(PRINCIPAL,ORG,PROJECT,INPUT,key),ack);
 await assert.rejects(service.capture(PRINCIPAL,ORG,PROJECT,INPUT,randomUUID()),e=>e.code==='GITHUB_NOT_CONFIGURED');
});
test('serialization conflicts become a 409 and do not leak database messages',async()=>{
 const f=fixture();f.repository.transaction=async()=>{throw {code:'P2010',meta:{code:'40001'},message:'secret DSN'};};
 await assert.rejects(f.capture(),e=>e.status===409&&!e.message.includes('secret'));
});
