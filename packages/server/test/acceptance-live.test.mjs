/** Real database acceptance. No memory adapter, test authentication bypass, or customer credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const strict = process.env.NAVYIX_REQUIRE_INTEGRATION === '1';
const configured = Boolean(process.env.NAVYIX_TEST_DATABASE_URL && process.env.NAVYIX_TEST_ADMIN_URL && process.env.NAVYIX_TEST_DB_CONFIRM === 'disposable');
const forbidden = error => error.status === 403;
const hidden = error => error.status === 404;
const conflict = error => error.status === 409;

test('live acceptance: Design → Build → Test → Readiness with two isolated organizations', {
  skip: !configured && !strict ? 'Disposable PostgreSQL not configured; acceptance NOT executed.' : false,
  timeout: 120_000
}, async t => {
  assert.ok(configured, 'A migrated disposable database and explicit NAVYIX_TEST_DB_CONFIRM=disposable are required.');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaWorkflowRepository } = await import('../src/repository.mjs');
  const { WorkflowService } = await import('../src/service.mjs');
  const runtime = new URL(process.env.NAVYIX_TEST_DATABASE_URL);
  runtime.searchParams.set('connection_limit', '1'); // Exercise transaction-scoped context on a reused connection.
  const db = new PrismaClient({ datasourceUrl: runtime.href });
  const dbOther = new PrismaClient({ datasourceUrl: runtime.href });
  const admin = new PrismaClient({ datasourceUrl: process.env.NAVYIX_TEST_ADMIN_URL });
  const org = [randomUUID(), randomUUID()], users = Array.from({ length: 5 }, () => randomUUID());
  const people = users.map(subject => ({ issuer: 'https://acceptance.navyix.invalid', subject }));
  let projectA, projectB, roleProject, snapshot, replay;
  let clock = Date.now() - 60_000;
  const repo = new PrismaWorkflowRepository(db), service = new WorkflowService(repo, { clock: () => ++clock });
  const competingService = new WorkflowService(new PrismaWorkflowRepository(dbOther), { clock: () => ++clock });
  const orgKey = index => ({ id: org[index] });
  const projectMembership = index => ({ orgId_projectId_userId: { orgId: org[0], projectId: roleProject, userId: users[index] } });
  const currentA = () => service.get(people[0], org[0], projectA);
  const applyA = async (type, input) => {
    const p = await currentA();
    return service.command(people[0], org[0], projectA, { expectedRevision: p.revision, type, input }, randomUUID());
  };
  const context = (person, orgId, fn) => db.$transaction(async tx => {
    await tx.$queryRawUnsafe("SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),set_config('navyix.org_id',$3,true)", person.issuer, person.subject, orgId);
    return fn(tx);
  });
  try {
    await repo.assertRuntime(); await new PrismaWorkflowRepository(dbOther).assertRuntime();
    for (let index = 0; index < users.length; index++) await admin.user.create({ data: {
      id: users[index], oidcIssuer: people[index].issuer, oidcSubject: people[index].subject, email: `${users[index]}@acceptance.invalid`
    } });
    for (let index = 0; index < 2; index++) {
      await admin.organization.create({ data: { id: org[index], name: 'Disposable Navyix acceptance', slug: org[index] } });
      await admin.membership.create({ data: { id: randomUUID(), orgId: org[index], userId: users[index], role: 'OWNER' } });
    }
    const input = { name: 'Acceptance project', goal: 'Verify evidence-backed readiness and tenant boundaries', owner: 'Synthetic acceptance owner', environment: 'staging' };
    projectA = (await service.create(people[0], org[0], input, randomUUID())).projectId;
    projectB = (await service.create(people[1], org[1], input, randomUUID())).projectId;
    roleProject = (await service.create(people[0], org[0], { ...input, name: 'Role checks' }, randomUUID())).projectId;
    for (const [index, role] of [[2, 'VIEWER'], [3, 'CONTRIBUTOR'], [4, 'REVIEWER']]) {
      await admin.membership.create({ data: { id: randomUUID(), orgId: org[0], userId: users[index], role } });
      await admin.projectMembership.create({ data: { orgId: org[0], projectId: roleProject, userId: users[index], role } });
    }
    await t.test('both organizations see their own projects; known foreign IDs remain hidden', async () => {
      assert.equal((await currentA()).id, projectA);
      assert.equal((await service.get(people[1], org[1], projectB)).id, projectB);
      const a = await service.list(people[0], org[0]), b = await service.list(people[1], org[1]);
      assert.ok(a.projects.some(p => p.id === projectA)); assert.ok(!a.projects.some(p => p.id === projectB));
      assert.deepEqual(b.projects.map(p => p.id), [projectB]);
      await assert.rejects(service.get(people[1], org[0], projectA), hidden);
      await assert.rejects(service.get(people[0], org[0], projectB), hidden);
      await assert.rejects(service.get(people[0], org[1], projectB), hidden);
    });
    await t.test('VIEWER reads but cannot create, edit, review or record an assessment', async () => {
      const p = await service.get(people[2], org[0], roleProject);
      await assert.rejects(service.create(people[2], org[0], input, randomUUID()), forbidden);
      for (const [type, payload] of [['requirement.add', { title: 'Must reject', acceptance: 'No write' }], ['assessment.create', { stage: 'design' }]]) {
        await assert.rejects(service.command(people[2], org[0], roleProject, { expectedRevision: p.revision, type, input: payload }, randomUUID()), forbidden);
      }
      assert.equal((await service.get(people[2], org[0], roleProject)).revision, p.revision);
      await assert.rejects(service.get(people[2], org[0], projectA), hidden); // Organization membership alone is insufficient.
    });
    await t.test('CONTRIBUTOR edits but cannot review; REVIEWER reviews but cannot edit', async () => {
      const command = { expectedRevision: 1, type: 'requirement.add', input: { title: 'Role boundary', acceptance: 'Only a permitted reviewer records review.' } };
      await service.command(people[3], org[0], roleProject, command, randomUUID());
      const review = { expectedRevision: 2, type: 'requirement.review', input: { id: 'REQ-001', expectedRevision: 1 } };
      await assert.rejects(service.command(people[3], org[0], roleProject, review, randomUUID()), forbidden);
      await assert.rejects(service.command(people[4], org[0], roleProject, { ...command, expectedRevision: 2 }, randomUUID()), forbidden);
      await service.command(people[4], org[0], roleProject, review, randomUUID());
      const p = await service.get(people[4], org[0], roleProject);
      assert.equal(p.requirements[0].serverReview.actorId, users[4]);
    });
    await t.test('full workflow persists failed test → blocker → passing retest → saved assessment', async () => {
      await applyA('requirement.add', { title: 'Email OTP login', acceptance: 'Used codes cannot be reused.' });
      await applyA('requirement.review', { id: 'REQ-001', expectedRevision: 1 });
      await applyA('design.add', { title: 'OTP reuse prevention', decision: 'Atomically consume an unexpired code.', requirementIds: ['REQ-001'] });
      await applyA('design.review', { id: 'DSN-001' });
      await applyA('build.add', { label: 'Synthetic acceptance artifact', commitSha: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}`, status: 'succeeded' });
      await applyA('test.add', { title: 'Reject OTP replay', requirementId: 'REQ-001', steps: 'Submit the same code twice.', expected: 'Second submission rejected.' });
      const target = { stage: 'release', buildId: 'BLD-001', environment: 'staging' };
      const result = async status => {
        const report = await service.template(people[0], org[0], projectA, 'BLD-001');
        report.runId = randomUUID(); report.executedAt = new Date(++clock).toISOString(); report.results[0].status = status;
        return applyA('results.import', { report });
      };
      await result('failed'); assert.equal((await service.assess(people[0], org[0], projectA, target)).status, 'Blocked');
      await result('passed'); assert.equal((await service.assess(people[0], org[0], projectA, target)).status, 'Ready');
      await applyA('assessment.create', target);
      snapshot = await service.assessment(people[0], org[0], projectA, 'ASM-001');
      assert.equal(snapshot.status, 'Ready'); assert.equal(snapshot.advisory, true);
      assert.equal(snapshot.serverRecord.actorId, users[0]);
      assert.match(snapshot.evidenceTrust, /not independently verified/);
    });
    await t.test('changing requirements invalidates current readiness without rewriting history', async () => {
      await applyA('requirement.update', { id: 'REQ-001', expectedRevision: 1, title: 'Email OTP login', acceptance: 'Used AND expired codes must be rejected.' });
      assert.notEqual((await service.assess(people[0], org[0], projectA, { stage: 'release', buildId: 'BLD-001' })).status, 'Ready');
      assert.deepEqual(await service.assessment(people[0], org[0], projectA, 'ASM-001'), snapshot);
      await assert.rejects(service.assessment(people[1], org[0], projectA, 'ASM-001'), hidden);
    });
    await t.test('invalid report rolls back state, audit and receipt writes atomically', async () => {
      const p = await currentA(), requestId = randomUUID();
      const auditBefore = await admin.auditEvent.count({ where: { orgId: org[0] } });
      const report = await service.template(people[0], org[0], projectA, 'BLD-001');
      report.runId = randomUUID(); report.artifactDigest = `sha256:${'c'.repeat(64)}`;
      await assert.rejects(service.command(people[0], org[0], projectA, { expectedRevision: p.revision, type: 'results.import', input: { report } }, requestId), error => error.status === 400);
      assert.deepEqual(await currentA(), p);
      assert.equal(await admin.auditEvent.count({ where: { orgId: org[0] } }), auditBefore);
      assert.equal(await admin.workflowCommand.count({ where: { orgId: org[0], requestId } }), 0);
    });
    await t.test('concurrent edits at one revision cannot both succeed', async () => {
      const p = await currentA();
      const outcomes = await Promise.allSettled(['One', 'Two'].map((title, index) => (index ? competingService : service).command(people[0], org[0], projectA, {
        expectedRevision: p.revision, type: 'requirement.add', input: { title, acceptance: 'Concurrent change is detected.' }
      }, randomUUID())));
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter(r => r.status === 'rejected' && conflict(r.reason)).length, 1);
      assert.equal((await currentA()).revision, p.revision + 1);
    });
    await t.test('idempotent replay returns the original result without new writes; changed payload is refused', async () => {
      const p = await currentA(), requestId = randomUUID();
      const request = { expectedRevision: p.revision, type: 'requirement.add', input: { title: 'Retry semantics', acceptance: 'An uncertain save is not duplicated.' } };
      const first = await service.command(people[0], org[0], projectA, request, requestId);
      const auditBefore = await admin.auditEvent.count({ where: { orgId: org[0] } });
      assert.deepEqual(await service.command(people[0], org[0], projectA, request, requestId), first);
      assert.equal((await currentA()).revision, first.revision);
      assert.equal(await admin.auditEvent.count({ where: { orgId: org[0] } }), auditBefore);
      await assert.rejects(service.command(people[0], org[0], projectA, { ...request, input: { ...request.input, title: 'Changed' } }, requestId), conflict);
      replay = { request, requestId };
    });
    await t.test('revoked organization membership denies reads and previously successful request replay', async () => {
      const where = { orgId_userId: { orgId: org[0], userId: users[0] } };
      await admin.membership.update({ where, data: { active: false } });
      try {
        await assert.rejects(currentA(), hidden);
        await assert.rejects(service.command(people[0], org[0], projectA, replay.request, replay.requestId), hidden);
      } finally { await admin.membership.update({ where, data: { active: true } }); }
    });
    await t.test('revoked project membership takes effect on the next request', async () => {
      await admin.projectMembership.update({ where: projectMembership(2), data: { active: false } });
      try { await assert.rejects(service.get(people[2], org[0], roleProject), hidden); }
      finally { await admin.projectMembership.update({ where: projectMembership(2), data: { active: true } }); }
    });
    await t.test('suspended organization and disabled identity cannot access records', async () => {
      await admin.organization.update({ where: orgKey(0), data: { active: false } });
      try { await assert.rejects(currentA(), hidden); await assert.rejects(service.list(people[0], org[0]), hidden); }
      finally { await admin.organization.update({ where: orgKey(0), data: { active: true } }); }
      await admin.user.update({ where: { id: users[0] }, data: { active: false } });
      try { await assert.rejects(currentA(), hidden); }
      finally { await admin.user.update({ where: { id: users[0] }, data: { active: true } }); }
    });
    await t.test('direct runtime SQL fails closed with no or forged tenant context; pool context is cleared', async () => {
      assert.equal((await db.$queryRawUnsafe('SELECT * FROM "WorkflowState"')).length, 0);
      assert.equal((await context(people[1], org[0], tx => tx.$queryRawUnsafe('SELECT * FROM "WorkflowState"'))).length, 0);
      const rows = await context(people[1], org[1], tx => tx.$queryRawUnsafe('SELECT "projectId" FROM "WorkflowState"'));
      assert.deepEqual(rows.map(r => r.projectId), [projectB]);
      const [after] = await db.$queryRawUnsafe("SELECT current_setting('navyix.org_id',true) AS org, current_setting('navyix.subject',true) AS subject");
      assert.ok(!after.org); assert.ok(!after.subject);
    });
    await t.test('runtime cannot mutate prior snapshots/audits, truncate records, or assume the administrator role', async () => {
      for (const sql of ['UPDATE "WorkflowSnapshot" SET data=data WHERE false', 'DELETE FROM "WorkflowSnapshot" WHERE false',
        'DELETE FROM "AuditEvent" WHERE false', 'TRUNCATE TABLE "WorkflowState"', 'SET ROLE postgres']) await assert.rejects(db.$executeRawUnsafe(sql));
      assert.deepEqual(await service.assessment(people[0], org[0], projectA, 'ASM-001'), snapshot);
    });
  } finally {
    // No TRUNCATE or broad deletion: only records for this fixture's random UUIDs.
    // Release both connections even when cleanup itself fails.
    try {
      for (const table of ['WorkflowSnapshot', 'WorkflowCommand', 'AuditEvent', 'WorkflowState', 'ProjectMembership', 'Project', 'Membership', 'Organization']) {
        const column = table === 'Organization' ? 'id' : 'orgId';
        await admin.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${column}" IN ($1::uuid,$2::uuid)`, ...org);
      }
      await admin.user.deleteMany({ where: { id: { in: users } } });
    } finally { await Promise.all([db.$disconnect(), dbOther.$disconnect(), admin.$disconnect()]); }
  }
});
