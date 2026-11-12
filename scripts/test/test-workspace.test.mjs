import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GROUPS, options, supportedNode, executionEnvironment, discover, evaluate, execute } from '../lib/test-workspace.mjs';

function fixture(t, groups = ['workflow']) {
  const root = mkdtempSync(join(tmpdir(), 'navyix-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const group of groups) mkdirSync(join(root, GROUPS[group]), { recursive: true });
  const add = (name, code, group = groups[0]) => { const path = join(root, GROUPS[group], name); mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, code); return path; };
  return { root, add };
}
const pass = "import test from 'node:test'; import assert from 'node:assert/strict'; test('real assertion',()=>assert.equal(2+2,4));";
const counts = (extra = {}) => ({ tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, topLevel: 1, ...extra });
const summary = (extra = {}) => ({ success: true, counts: counts(), ...extra });

test('default groups include policy, workflow, server, browser AND tooling', () => assert.deepEqual(options([]).groups, Object.keys(GROUPS)));
test('explicit groups may be combined without shell globs', () => assert.deepEqual(options(['--group', 'workflow', '--group', 'policy']).groups, ['workflow', 'policy']));
test('strict integration and list flags parse', () => assert.deepEqual(options(['--integration', '--list', '--group', 'server']), { groups: ['server'], integration: true, list: true }));
for (const args of [['--group'], ['--group', 'unknown'], ['--group', '__proto__'], ['--group', 'workflow', '--group', 'workflow'], ['--integration', '--integration'], ['--list', '--list'], ['--deploy'], ['--group', '../../']]) {
  test(`reject invalid options ${JSON.stringify(args)}`, () => assert.throws(() => options(args)));
}
for (const [version, valid] of [['20.9.0', false], ['22.0.0', false], ['22.15.9', false], ['22.16.0', true], ['22.19.0', true], ['24.0.0', true], ['nonsense', false]]) {
  test(`Node summary support ${version}`, () => assert.equal(supportedNode(version), valid));
}
test('ordinary tests remove inherited database URLs and strict integration switches', () => {
  const original = { PATH: '/safe', NAVYIX_TEST_ADMIN_URL: 'secret', NAVYIX_TEST_DB_CONFIRM: 'disposable', NAVYIX_REQUIRE_INTEGRATION: '1', NAVYIX_REQUIRE_BROWSER_INTEGRATION: '1', NODE_TEST_CONTEXT: 'child-v8' };
  assert.deepEqual(executionEnvironment(original, false), { PATH: '/safe' }); assert.equal(original.NAVYIX_TEST_ADMIN_URL, 'secret');
});
const integrationEnv = { NAVYIX_TEST_DB_CONFIRM: 'disposable', NAVYIX_TEST_DATABASE_URL: 'postgresql://runtime@localhost/test', NAVYIX_TEST_ADMIN_URL: 'postgres://admin@localhost/test', NAVYIX_TEST_BROWSER_DATABASE_URL: 'postgresql://session@localhost/test' };
test('strict tests set both required integration flags', () => { const env = executionEnvironment(integrationEnv, true); assert.equal(env.NAVYIX_REQUIRE_INTEGRATION, '1'); assert.equal(env.NAVYIX_REQUIRE_BROWSER_INTEGRATION, '1'); });
for (const name of Object.keys(integrationEnv)) test(`strict execution rejects missing ${name}`, () => { const env = { ...integrationEnv }; delete env[name]; assert.throws(() => executionEnvironment(env, true)); });
test('invalid database protocol does not leak credentials', () => {
  assert.throws(() => executionEnvironment({ ...integrationEnv, NAVYIX_TEST_ADMIN_URL: 'https://admin:private-secret@host/test' }, true), error => !error.message.includes('private-secret'));
});
test('missing required directory fails before execution', t => { const { root } = fixture(t); assert.throws(() => discover(root, ['server']), /Missing test directory/); });
test('empty required group fails before execution', t => { const { root } = fixture(t); assert.throws(() => discover(root, ['workflow']), /No test files/); });
test('test files are recursively explicit, deterministically discovered; helpers ignored', t => {
  const { root, add } = fixture(t); const b = add('nested/b.test.mjs', pass), a = add('a.test.mjs', pass); add('support/helper.mjs', '');
  const plan = discover(root, ['workflow']); assert.deepEqual(plan.files, [a, b]); assert.equal(plan.inventory, 'filesystem-only');
});
test('symlinked tests cannot escape the source tree', t => {
  const { root, add } = fixture(t); add('target/safe.mjs', pass); symlinkSync(join(root, GROUPS.workflow, 'target'), join(root, GROUPS.workflow, 'linked'), 'junction');
  assert.throws(() => discover(root, ['workflow']), /Symlinks/);
});
test('tracked test missing from sparse checkout fails', t => {
  const { root, add } = fixture(t); add('present.test.mjs', pass); mkdirSync(join(root, '.git'));
  assert.throws(() => discover(root, ['workflow'], { git: () => ({ status: 0, stdout: `${GROUPS.workflow}/missing.test.mjs\0` }) }), /Missing tracked/);
});
test('Git inspection failure is not silently ignored', t => {
  const { root, add } = fixture(t); add('one.test.mjs', pass); mkdirSync(join(root, '.git'));
  assert.throws(() => discover(root, ['workflow'], { git: () => ({ status: 1 }) }), /tracked test inventory/);
});
test('Git inspection uses argument arrays and includes discovered untracked tests', t => {
  const { root, add } = fixture(t); add('one.test.mjs', pass); add('new.test.mjs', pass); mkdirSync(join(root, '.git'));
  const plan = discover(root, ['workflow'], { git: (cmd, args, settings) => { assert.equal(cmd, 'git'); assert.equal(settings.shell, false); assert.ok(args.includes('--')); return { status: 0, stdout: `${GROUPS.workflow}/one.test.mjs\0` }; } });
  assert.equal(plan.files.length, 2); assert.equal(plan.inventory, 'tracked-tests-checked');
});
const dummy = { root: '/repo', files: ['/repo/tests/a.test.mjs'], groups: ['workflow'], inventory: 'filesystem-only' };
test('empty file synthetic pass is rejected without a per-file summary', () => assert.equal(evaluate(dummy, new Map(), summary(), [], false).status, 'failed'));
test('no tests is a failure even with a successful final event', () => assert.equal(evaluate(dummy, new Map([[dummy.files[0], summary({ counts: counts({ tests: 0 }) })]]), summary(), [], false).status, 'failed'));
test('declared successful tests pass', () => assert.equal(evaluate(dummy, new Map([[dummy.files[0], summary()]]), summary(), [], false).status, 'passed'));
test('missing final summary fails', () => assert.equal(evaluate(dummy, new Map([[dummy.files[0], summary()]]), null, [], false).status, 'failed'));
test('skips are explicit in normal mode and fail in strict mode', () => {
  const skipped = summary({ counts: counts({ skipped: 1, passed: 0 }) }), files = new Map([[dummy.files[0], skipped]]);
  assert.equal(evaluate(dummy, files, skipped, [], false).status, 'passed-with-skips'); assert.equal(evaluate(dummy, files, skipped, [], true).status, 'failed');
});
test('TODO cannot silently pass', () => {
  const todo = summary({ counts: counts({ todo: 1, passed: 0 }) }); assert.equal(evaluate(dummy, new Map([[dummy.files[0], todo]]), todo, [], false).status, 'failed');
});
test('cancelled test cannot silently pass', () => {
  const cancelled = summary({ success: false, counts: counts({ cancelled: 1 }) }); assert.equal(evaluate(dummy, new Map([[dummy.files[0], cancelled]]), cancelled, [], false).status, 'failed');
});
test('runner error is a failure, not an empty pass', async () => {
  const result = await execute(dummy, { runner: () => { throw new Error('synthetic runner failure'); } }); assert.equal(result.status, 'failed');
});

// A fresh Node process verifies actual node:test behavior, not only mocked event streams.
function actual(t, code, strict = false) {
  const { root, add } = fixture(t); add('example.test.mjs', code);
  const module = pathToFileURL(resolve(import.meta.dirname, '../lib/test-workspace.mjs')).href;
  const launcher = join(root, 'run.mjs');
  writeFileSync(launcher, `import {discover,execute} from ${JSON.stringify(module)}; const result=await execute(discover(${JSON.stringify(root)},['workflow']),{integration:${strict}}); console.log(JSON.stringify(result)); process.exitCode=result.status==='failed'?1:0;`);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [launcher], { env, encoding: 'utf8', timeout: 15000, shell: false });
  assert.equal(result.error, undefined, result.stderr); return { ...result, report: JSON.parse(result.stdout.trim()) };
}
test('real runner accepts real assertions', t => { const r = actual(t, pass); assert.equal(r.status, 0); assert.equal(r.report.declaredTests, 1); });
test('real runner rejects a no-op file that bare Node reports as passed', t => { const r = actual(t, 'export const notATest=1;'); assert.equal(r.status, 1); assert.equal(r.report.declaredTests, 0); });
test('real runner rejects a failing assertion', t => { const r = actual(t, pass.replace('2+2,4', '2+2,5')); assert.equal(r.status, 1); });
test('real runner reports skipped integration instead of full pass', t => { const r = actual(t, "import test from 'node:test';test('integration',{skip:'not configured'},()=>{});"); assert.equal(r.status, 0); assert.equal(r.report.status, 'passed-with-skips'); });
test('real strict runner rejects skipped integration', t => { const r = actual(t, "import test from 'node:test';test('integration',{skip:true},()=>{});", true); assert.equal(r.status, 1); });
test('real runner rejects TODO', t => { const r = actual(t, "import test from 'node:test';test.todo('future implementation');"); assert.equal(r.status, 1); });
test('real runner rejects module import failure', t => { const r = actual(t, "import './missing.mjs';"); assert.equal(r.status, 1); });
