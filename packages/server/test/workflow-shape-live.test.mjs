import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const required = process.env.NAVYIX_REQUIRE_INTEGRATION === '1';
const live = process.env.NAVYIX_TEST_DB_CONFIRM === 'disposable' && Boolean(process.env.NAVYIX_TEST_ADMIN_URL);
const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));

test('PostgreSQL: strict workflow/snapshot JSON guards reject absent and mismatched fields', {
  skip: !live && !required ? 'Disposable PostgreSQL not configured; SQL constraints NOT executed' : false
}, async t => {
  assert.ok(live, 'Use only a migrated disposable database with explicit confirmation.');
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.NAVYIX_TEST_ADMIN_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const user = randomUUID(), org = randomUUID(), project = randomUUID();
  let connected = false, begun = false;
  try {
    await db.connect(); connected = true; await db.query('BEGIN'); begun = true;
    const constraints = await db.query(`SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid IN ('public."WorkflowState"'::regclass, 'public."WorkflowSnapshot"'::regclass)
      AND conname IN ('workflow_shape','snapshot_shape')`);
    assert.equal(constraints.rows.length, 2);
    for (const row of constraints.rows) { assert.equal(row.convalidated, true); assert.match(row.definition, /IS TRUE/); }
    await db.query('INSERT INTO public."User" (id,"oidcIssuer","oidcSubject",email) VALUES ($1,$2,$3,$4)', [user, 'https://shape.example', user, user + '@example.test']);
    await db.query('INSERT INTO public."Organization" (id,name,slug) VALUES ($1,$2,$3)', [org, 'Disposable shape test', org]);
    await db.query('INSERT INTO public."Membership" (id,"orgId","userId",role) VALUES ($1,$2,$3,$4)', [randomUUID(), org, user, 'OWNER']);
    await db.query('INSERT INTO public."Project" (id,"orgId",name,key) VALUES ($1,$2,$3,$4)', [project, org, 'Disposable shape test', project]);
    const state = { id: project, revision: 1 };
    await db.query('INSERT INTO public."WorkflowState" ("orgId","projectId",revision,data) VALUES ($1,$2,1,$3::jsonb)', [org, project, JSON.stringify(state)]);
    const snapshot = { id: 'ASM-001', projectId: project, advisory: true };
    await db.query('INSERT INTO public."WorkflowSnapshot" ("orgId","projectId",id,"actorId",data) VALUES ($1,$2,$3,$4,$5::jsonb)', [org, project, snapshot.id, user, JSON.stringify(snapshot)]);
    const rejects = async (table, constraint, data) => {
      await db.query('SAVEPOINT shape_case');
      try {
        // table and constraint are fixed test constants, never request input.
        await assert.rejects(db.query(`UPDATE public."${table}" SET data=$1::jsonb WHERE "orgId"=$2 AND "projectId"=$3`,
          [JSON.stringify(data), org, project]), e => e.code === '23514' && e.constraint === constraint);
      } finally { await db.query('ROLLBACK TO SAVEPOINT shape_case'); await db.query('RELEASE SAVEPOINT shape_case'); }
    };
    for (const [label, data] of [
      ['empty object', {}], ['JSON null', null], ['array', []], ['missing id', { revision: 1 }],
      ['missing revision', { id: project }], ['null id', { id: null, revision: 1 }],
      ['null revision', { id: project, revision: null }], ['string revision', { id: project, revision: '1' }],
      ['wrong project', { id: randomUUID(), revision: 1 }], ['wrong revision', { id: project, revision: 2 }],
      ['fractional revision', { id: project, revision: 1.5 }]
    ]) await t.test('WorkflowState rejects ' + label, () => rejects('WorkflowState', 'workflow_shape', data));
    for (const [label, data] of [
      ['empty object', {}], ['JSON null', null], ['missing id', { projectId: project, advisory: true }],
      ['missing project', { id: 'ASM-001', advisory: true }], ['missing advisory', { id: 'ASM-001', projectId: project }],
      ['non-advisory', { ...snapshot, advisory: false }], ['string boolean', { ...snapshot, advisory: 'true' }],
      ['null advisory', { ...snapshot, advisory: null }], ['wrong project', { ...snapshot, projectId: randomUUID() }],
      ['wrong snapshot', { ...snapshot, id: 'ASM-002' }]
    ]) await t.test('WorkflowSnapshot rejects ' + label, () => rejects('WorkflowSnapshot', 'snapshot_shape', data));
    await t.test('failed changes preserve both valid records', async () => {
      assert.deepEqual((await db.query('SELECT data FROM public."WorkflowState" WHERE "projectId"=$1', [project])).rows[0].data, state);
      assert.deepEqual((await db.query('SELECT data FROM public."WorkflowSnapshot" WHERE "projectId"=$1', [project])).rows[0].data, snapshot);
    });
  } finally {
    try { if (begun) await db.query('ROLLBACK'); }
    finally { if (connected) await db.end(); }
  }
});
