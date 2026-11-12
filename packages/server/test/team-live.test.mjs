import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { TeamService, PrismaTeamRepository } from '../src/team.mjs';

const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const strict = process.env.NAVYIX_REQUIRE_INTEGRATION === '1';
const live = Boolean(process.env.NAVYIX_TEST_DATABASE_URL && process.env.NAVYIX_TEST_ADMIN_URL && process.env.NAVYIX_TEST_DB_CONFIRM === 'disposable');
// Never accepts a production deployment implicitly; the integration lab supplies fresh disposable URLs.
test('integration: real PostgreSQL project-team functions, role ceilings, revocation and atomic receipts', {
  skip: !live && !strict ? 'Migrated disposable PostgreSQL unavailable; team SQL and RLS NOT executed' : false
}, async t => {
  assert.ok(live, 'Use the integration lab and explicitly confirm a disposable database.');
  const { PrismaClient } = require('@prisma/client');
  const runtime = new URL(process.env.NAVYIX_TEST_DATABASE_URL); runtime.searchParams.set('connection_limit', '1');
  const admin = new PrismaClient({ datasourceUrl: process.env.NAVYIX_TEST_ADMIN_URL });
  const db = new PrismaClient({ datasourceUrl: runtime.href });
  const orgs = [randomUUID(), randomUUID()], projects = [randomUUID(), randomUUID()];
  const users = Array.from({ length: 6 }, () => randomUUID());
  const issuer = 'https://team-integration.example';
  const principal = index => ({ issuer, subject: users[index] });
  const command = (userId, role, active = true, expectedRevision = 0) => ({ userId, role, active, expectedRevision });
  const denied = e => e.status === 404;
  try {
    for (let i = 0; i < users.length; i++) await admin.user.create({ data: { id: users[i], oidcIssuer: issuer, oidcSubject: users[i], email: `${users[i]}@example.test` } });
    for (let i = 0; i < 2; i++) {
      await admin.organization.create({ data: { id: orgs[i], name: 'Disposable team test', slug: orgs[i] } });
      await admin.project.create({ data: { id: projects[i], orgId: orgs[i], name: 'Access verification', key: projects[i] } });
    }
    const roles = ['OWNER', 'OWNER', 'CONTRIBUTOR', 'REVIEWER', 'ADMIN', 'VIEWER'];
    for (let i = 0; i < users.length; i++) await admin.membership.create({ data: { id: randomUUID(), orgId: i === 1 ? orgs[1] : orgs[0], userId: users[i], role: roles[i] } });
    for (let i = 0; i < 2; i++) await admin.projectMembership.create({ data: { orgId: orgs[i], projectId: projects[i], userId: users[i], role: 'OWNER' } });
    const repository = new PrismaTeamRepository(db), service = new TeamService(repository);
    await repository.assertRuntime();
    const write = (input, id = randomUUID(), actor = 0) => service.change(principal(actor), orgs[0], projects[0], input, id);
    const list = () => service.list(principal(0), orgs[0], projects[0], { limit: 50 });
    await t.test('authorized directory excludes the other organization and protects owner', async () => {
      const page = await list(); assert.equal(page.members.length, 5);
      assert.equal(page.members.some(m => m.userId === users[1]), false);
      assert.equal(page.members.find(m => m.userId === users[0]).editable, false);
      assert.equal(page.members.find(m => m.userId === users[2]).accessRevision, 0);
      const a = await service.list(principal(0), orgs[0], projects[0], { limit: 2 });
      assert.equal(a.members.length, 2); assert.ok(a.next);
      const b = await service.list(principal(0), orgs[0], projects[0], { after: a.next, limit: 2 });
      assert.equal(b.members.some(m => a.members.some(x => x.userId === m.userId)), false);
    });
    await t.test('grants persist with one atomic audit and idempotency receipt', async () => {
      const id = randomUUID(), input = command(users[2], 'CONTRIBUTOR');
      const result = await write(input, id); assert.equal(result.accessRevision, 1);
      assert.deepEqual(await write(input, id), result);
      const row = await admin.projectMembership.findUnique({ where: { orgId_projectId_userId: { orgId: orgs[0], projectId: projects[0], userId: users[2] } } });
      assert.equal(row.role, 'CONTRIBUTOR'); assert.equal(row.active, true);
      assert.equal(await admin.workflowCommand.count({ where: { orgId: orgs[0], actorId: users[0], requestId: id } }), 1);
      const [count] = await admin.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AuditEvent" WHERE "orgId"=$1::uuid AND metadata->>'requestId'=$2`, orgs[0], id);
      assert.equal(count.n, 1);
      await assert.rejects(write(command(users[2], 'VIEWER', true, 1), id), e => e.status === 409);
    });
    await t.test('role ceilings, self changes and owner modifications fail without receipts', async () => {
      await assert.rejects(write(command(users[2], 'ADMIN', true, 1)), e => e.status === 400);
      await assert.rejects(write(command(users[5], 'REVIEWER')), e => e.status === 400);
      await assert.rejects(write(command(users[0], 'ADMIN', true, 1)), e => e.status === 400);
      await write(command(users[4], 'ADMIN'));
      await assert.rejects(write(command(users[0], 'VIEWER', true, 1), randomUUID(), 4), e => e.status === 400);
      await assert.rejects(write(command(users[2], 'VIEWER', true, 0)), e => e.status === 409);
    });
    await t.test('contributor and foreign project/organization cannot use administration', async () => {
      await assert.rejects(service.list(principal(2), orgs[0], projects[0]), denied);
      await assert.rejects(service.list(principal(1), orgs[0], projects[0]), denied);
      await assert.rejects(service.list(principal(0), orgs[0], projects[1]), denied);
      await assert.rejects(write(command(users[1], 'VIEWER')), denied);
    });
    await t.test('revoked admin cannot list or replay a previously acknowledged command', async () => {
      const id = randomUUID(), input = command(users[3], 'REVIEWER');
      await write(input, id, 4);
      await write(command(users[4], 'ADMIN', false, 1));
      await assert.rejects(service.list(principal(4), orgs[0], projects[0]), denied);
      await assert.rejects(write(input, id, 4), denied);
    });
    await t.test('external membership updates advance revision and stale writes are rejected', async () => {
      await admin.projectMembership.update({ where: { orgId_projectId_userId: { orgId: orgs[0], projectId: projects[0], userId: users[2] } }, data: { role: 'VIEWER' } });
      const row = (await list()).members.find(m => m.userId === users[2]); assert.equal(row.accessRevision, 2);
      await assert.rejects(write(command(users[2], 'VIEWER', false, 1)), e => e.status === 409);
      const result = await write(command(users[2], 'VIEWER', false, 2)); assert.equal(result.active, false); assert.equal(result.accessRevision, 3);
    });
    await t.test('inactive targets cannot be re-granted and suspended actors lose access', async () => {
      await admin.membership.update({ where: { orgId_userId: { orgId: orgs[0], userId: users[2] } }, data: { active: false } });
      await assert.rejects(write(command(users[2], 'CONTRIBUTOR', true, 3)), e => e.status === 400);
      await admin.organization.update({ where: { id: orgs[0] }, data: { active: false } });
      await assert.rejects(list(), denied);
      await admin.organization.update({ where: { id: orgs[0] }, data: { active: true } });
      await admin.user.update({ where: { id: users[0] }, data: { active: false } });
      await assert.rejects(list(), denied);
      await admin.user.update({ where: { id: users[0] }, data: { active: true } });
    });
    await t.test('runtime cannot update roles, invoke private helper or inherit function-owner rights', async () => {
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "ProjectMembership" SET role='ADMIN' WHERE "orgId"=$1::uuid`, orgs[0]));
      await assert.rejects(db.$queryRawUnsafe(`SELECT navyix_team.authorize($1::uuid)`, projects[0]));
      const [role] = await db.$queryRawUnsafe(`SELECT pg_has_role(current_user,'navyix_team_executor','MEMBER') AS inherited`);
      assert.equal(role.inherited, false);
      await assert.rejects(db.$queryRawUnsafe(`SELECT navyix_team.directory($1::uuid,NULL,20)`, projects[0]));
    });
    await t.test('forged organization context fails and pooled sessions retain no tenant context', async () => {
      await assert.rejects(db.$transaction(async tx => {
        await tx.$queryRawUnsafe(`SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),set_config('navyix.org_id',$3,true)`, issuer, users[1], orgs[0]);
        await tx.$queryRawUnsafe(`SELECT navyix_team.directory($1::uuid,NULL,20)`, projects[0]);
      }));
      const [context] = await db.$queryRawUnsafe(`SELECT current_setting('navyix.org_id',true) AS org`); assert.ok(!context.org);
    });
  } finally {
    // Only UUIDs created above; no TRUNCATE, shared schema drops, or broad deletes.
    for (const table of ['WorkflowSnapshot', 'WorkflowCommand', 'AuditEvent', 'WorkflowState', 'ProjectMembership', 'Project', 'Membership', 'Organization']) {
      const column = table === 'Organization' ? 'id' : 'orgId';
      await admin.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${column}" IN ($1::uuid,$2::uuid)`, ...orgs);
    }
    await admin.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect(); await admin.$disconnect();
  }
});
