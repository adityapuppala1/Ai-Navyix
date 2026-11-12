import test from 'node:test';
import assert from 'node:assert/strict';
import { options, plan, preflight, execute } from '../../../scripts/verify-workspace.mjs';
const env = { NAVYIX_TEST_DB_CONFIRM: 'disposable', NAVYIX_TEST_DATABASE_URL: 'postgresql://app@localhost/test', NAVYIX_TEST_ADMIN_URL: 'postgresql://admin@localhost/test', NAVYIX_TEST_BROWSER_DATABASE_URL: 'postgresql://browser@localhost/test' };

test('default verification never starts build processes', () => {
  let count = 0; const result = execute('/repo', options([]), { checks: [{ name: 'Synthetic prerequisites', passed: true }], run: () => count++ });
  assert.equal(count, 0); assert.equal(result.scope, 'prerequisites-only'); assert.equal(result.status, 'prerequisites-passed');
});
test('missing prerequisites block full verification without executing a command', () => {
  const result = execute('/repo', options(['--full']), { checks: [{ name: 'Lockfile', passed: false }], run: () => { throw new Error('Must not run'); } });
  assert.equal(result.status, 'blocked'); assert.equal(result.steps.length, 0);
});
test('strict integration requires disposable database confirmation and URLs before any command', () => {
  for (const missing of Object.keys(env)) {
    const config = { ...env }; delete config[missing];
    const result = execute('/repo', options(['--integration']), { checks: [], env: config, run: () => { throw new Error('Must not run'); } });
    assert.equal(result.status, 'blocked'); assert.equal(result.checks.at(-1).passed, false);
  }
});
test('plan never installs, migrates, dispatches CI, pushes or deploys', () => {
  for (const step of plan(options(['--integration']))) assert.doesNotMatch([step.command, ...step.args].join(' '), /install|migrate|db:push|deploy|workflow|git push/);
});
test('strict integration runs every workspace group once rather than two legacy suites only', () => {
  const steps = plan(options(['--integration']));
  const suites = steps.filter(s => s.args.includes('scripts/test-workspace.mjs'));
  assert.equal(suites.length, 1); assert.ok(suites[0].args.includes('--integration')); assert.equal(steps.length, 6);
});
test('Prisma schema validation uses the root environment wrapper', () => {
  assert.deepEqual(plan(options(['--full']))[0].args, ['--filter', '@navyix/api', 'db:validate']);
});
test('command failure stops subsequent checks and cannot become pass', () => {
  let count = 0; const result = execute('/repo', options(['--full']), { checks: [], run: () => ({ status: ++count === 2 ? 1 : 0 }) });
  assert.equal(count, 2); assert.equal(result.status, 'failed'); assert.equal(result.steps.at(-1).status, 'failed');
});
test('successful requested checks still list external acceptance gates', () => {
  const result = execute('/repo', options(['--integration']), { checks: [], env, run: () => ({ status: 0 }) });
  assert.equal(result.status, 'requested-local-checks-passed'); assert.equal(result.steps.length, 6); assert.ok(result.remaining.includes('Live provider login'));
});
test('ordinary build verification does not claim skipped integrations passed', () => {
  const result = execute('/repo', options(['--full']), { checks: [], run: () => ({ status: 0 }) });
  assert.match(result.remaining[0], /Skipped live integrations/);
});
test('unknown flags and missing report path are rejected', () => {
  assert.throws(() => options(['--deploy'])); assert.throws(() => options(['--report'])); assert.throws(() => options(['--report', '--full']));
});
test('preflight reports missing dependencies and old Node honestly', () => {
  const checks = preflight('/repo', { nodeVersion: '20.0.0', exists: () => false, dependency: () => false, inventory: () => { throw new Error(); } });
  assert.ok(checks.every(c => !c.passed));
});
test('preflight requires the declared TypeScript ESLint parser and all test groups', () => {
  const checks = preflight('/repo', { nodeVersion: '22.16.0', exists: () => true, dependency: (_, pkg) => pkg !== '@typescript-eslint/parser', inventory: () => ({ files: [] }) });
  assert.equal(checks.find(c => c.name.includes('@typescript-eslint/parser')).passed, false);
  assert.equal(checks.at(-1).passed, false);
});
test('preflight rejects Node 22 versions lacking per-file summary support', () => {
  assert.equal(preflight('/repo', { nodeVersion: '22.15.0', exists: () => true, dependency: () => true, inventory: () => ({ files: ['test.mjs'] }) })[0].passed, false);
});
