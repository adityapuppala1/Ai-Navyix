import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const migration = await readFile(new URL('../../../apps/api/prisma/migrations/202611120005_strict_workflow_shapes/migration.sql', import.meta.url), 'utf8');
const sql = migration.replace(/^--.*$/gm, '');
test('new shape guards reject SQL unknown results explicitly', () => {
  assert.equal((sql.match(/\) IS TRUE\) NOT VALID/g) || []).length, 2);
  assert.match(sql, /data->'revision' = to_jsonb\(revision\)/);
  assert.match(sql, /data->'advisory' = 'true'::jsonb/);
});
test('new guards validate existing data before old guards are removed', () => {
  for (const [table, name] of [['WorkflowState', 'workflow_shape'], ['WorkflowSnapshot', 'snapshot_shape']]) {
    const add = sql.indexOf(`ALTER TABLE public."${table}" ADD CONSTRAINT ${name}_strict`);
    const validate = sql.indexOf(`ALTER TABLE public."${table}" VALIDATE CONSTRAINT ${name}_strict`);
    const drop = sql.indexOf(`ALTER TABLE public."${table}" DROP CONSTRAINT ${name};`);
    assert.ok(add >= 0 && validate > add && drop > validate);
  }
});
test('migration is atomic and bounds blocking; it does not repair data or change grants', () => {
  assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/); assert.match(sql, /SET LOCAL statement_timeout = '60s'/);
  assert.doesNotMatch(sql, /\b(?:DELETE|INSERT|TRUNCATE|GRANT|REVOKE|DISABLE)\b/);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/);
});
