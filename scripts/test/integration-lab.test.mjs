import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { options, prerequisites, isolatedEnvironment, credentials, redact, sanitize, localEndpoint, databasePort,
  databaseEnvironment, tapSummary, runProcess, execute } from '../lib/integration-lab.mjs';
const RUN = 'c74303bc-12c0-4222-ae6d-e8b4133f1875';
const ID = 'a'.repeat(64), IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const TAP = '# tests 17\n# pass 17\n# fail 0\n# cancelled 0\n# skipped 0\n';
const settings = { run: true, full: false, image: 'postgres:17-alpine', report: null };
function fixture(overrides = {}) {
  const calls = [], c = credentials(RUN);
  const standard = (command, args) => {
    if (command === 'docker') {
      if (args[0] === 'context') return JSON.stringify([{ Name: 'desktop-linux', Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }]);
      if (args[0] === 'info') return '28.0.0';
      if (args[0] === 'image') return JSON.stringify([{ Id: IMAGE_ID, RepoDigests: [`postgres@${IMAGE_ID}`] }]);
      if (args[0] === 'create') return ID;
      if (args[0] === 'port') return '127.0.0.1:55432\n';
      if (args[0] === 'inspect') return JSON.stringify([{ Id: ID, Config: { Labels: { 'io.navyix.acceptance.run': RUN } } }]);
      if (args[0] === 'container') return ID;
      return '';
    }
    return args.includes('--test') ? TAP : '';
  };
  const dependencies = {
    checks: [{ name: 'Controlled test prerequisites', passed: true }], env: { PATH: process.env.PATH, HOME: '/tmp' },
    makeCredentials: () => c, sleep: async () => {}, read: () => '-- TEST SQL ONLY', resolvePackage: () => '/repo/node_modules/prisma/build/index.js',
    run: async (command, args, opts) => {
      calls.push({ command, args, opts });
      return overrides.respond?.(command, args, opts, calls) ?? { status: 0, stdout: standard(command, args), stderr: '' };
    }, ...overrides.dependencies
  };
  return { calls, c, dependencies, go: (s = settings) => execute('/repo', s, dependencies) };
}
test('default is read-only preflight, not an execution request', () => assert.deepEqual(options([]), { run: false, full: false, image: 'postgres:17-alpine', report: null }));
test('explicit execution and full verification are supported', () => assert.equal(options(['--run', '--full', '--report', 'a file.json']).full, true));
test('full verification requires explicit run consent', () => assert.throws(() => options(['--full']), /requires --run/));
for (const args of [['--run','--run'],['--unknown'],['--report'],['--database-url','postgresql://customer/db'],['--image','evil/postgres:17'],['--image','postgres:17-alpine;echo secret'],['--image','postgres:latest']])
  test(`reject unsupported or unsafe arguments: ${args[0]} ${args[1] || ''}`, () => assert.throws(() => options(args)));
test('allows a reviewed image digest', () => assert.equal(options(['--image', `postgres@sha256:${'a'.repeat(64)}`]).image, `postgres@sha256:${'a'.repeat(64)}`));
test('preflight reports missing lockfile and dependencies instead of inventing them', () => {
  const checks = prerequisites('/missing', { version: '20.0.0', exists: () => false, dependency: () => false });
  assert.ok(checks.every(check => !check.passed)); assert.ok(checks.some(check => check.name.includes('pnpm-lock')));
});
test('preflight can validate installed prerequisites without executing them', () => assert.ok(prerequisites('/repo', { version: '22.16.0', exists: () => true, dependency: () => true }).every(c => c.passed)));
test('production secrets, DB URLs, Node injection and feature flags do not leak into child environments', () => {
  const env = isolatedEnvironment({ PATH: '/bin', SystemRoot: 'C:\\Windows', DATABASE_URL: 'production', AWS_SECRET_ACCESS_KEY: 'secret', NODE_OPTIONS: '--require bad', NAVYIX_API_ENABLED: 'true', NAVYIX_BROWSER_ENABLED: 'true', HTTP_PROXY: 'secret' });
  assert.deepEqual(env, { PATH: '/bin', SystemRoot: 'C:\\Windows', CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NAVYIX_API_ENABLED: 'false', NAVYIX_BROWSER_ENABLED: 'false' });
});
test('fresh credentials are unique across roles and runs', () => {
  const a = credentials(), b = credentials(); assert.notEqual(a.runId, b.runId);
  assert.equal(new Set([a.adminPassword, a.runtimePassword, a.browserPassword, b.adminPassword]).size, 4);
  assert.match(a.adminPassword, /^[a-f0-9]{64}$/); assert.throws(() => credentials('bad'));
});
test('database URLs always use this run’s loopback port and enforce strict integration', () => {
  const env = databaseEnvironment(credentials(), 55432);
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1'); assert.equal(new URL(env.DATABASE_URL).username, 'navyix_app');
  assert.equal(new URL(env.NAVYIX_TEST_BROWSER_DATABASE_URL).username, 'navyix_browser');
  assert.equal(env.NAVYIX_TEST_DB_CONFIRM, 'disposable'); assert.equal(env.NAVYIX_REQUIRE_INTEGRATION, '1'); assert.equal(env.NAVYIX_REQUIRE_BROWSER_INTEGRATION, '1');
  assert.throws(() => databaseEnvironment(credentials(), -1));
});
test('local endpoint guard rejects remote Docker daemons', () => {
  assert.equal(localEndpoint('unix:///var/run/docker.sock'), true); assert.equal(localEndpoint('npipe:////./pipe/docker_engine'), true);
  for (const host of ['tcp://127.0.0.1:2375', 'ssh://server', 'https://host', null]) assert.equal(localEndpoint(host), false);
});
for (const port of ['0.0.0.0:5432', '[::]:5432', '127.0.0.1:0', '127.0.0.1:99999', '127.0.0.1:5432\n0.0.0.0:5432'])
  test(`port binding fails closed: ${port}`, () => assert.throws(() => databasePort(port)));
test('valid loopback port is accepted', () => assert.equal(databasePort('127.0.0.1:55432\n'), 55432));
test('redacts database URLs and known generated secrets', () => {
  const text = redact('postgresql://admin:pw@127.0.0.1:1/db password=secret token ABC', ['ABC', 'secret']);
  assert.ok(!text.includes('pw@')); assert.ok(!text.includes('secret')); assert.ok(!text.includes('ABC'));
});
test('structured sanitization cannot corrupt JSON when a diagnostic contains password= text', () => {
  const value = sanitize({ error: 'password=abc', nested: ['postgresql://u:p@host/db'], good: true }, ['abc']);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value); assert.equal(value.good, true); assert.ok(!JSON.stringify(value).includes('abc'));
});
test('strict TAP requires a nonempty zero-skip run', () => assert.equal(tapSummary(TAP).passed, 17));
for (const bad of ['', TAP.replace('# skipped 0', '# skipped 1'), TAP.replace('# fail 0', '# fail 1'), TAP.replace('# cancelled 0', '# cancelled 1'), TAP.replaceAll('17','0'), TAP + '# tests 17\n', TAP.replace('# pass 17','# pass 16')])
  test(`strict TAP rejects incomplete, skipped or failed summary ${JSON.stringify(bad).slice(0,30)}`, () => assert.throws(() => tapSummary(bad)));
test('unmet prerequisites do not contact Docker or create credentials', async () => {
  const f = fixture({ dependencies: { checks: [{ name: 'missing', passed: false }], makeCredentials: () => { throw new Error('must not run'); } } });
  assert.equal((await f.go()).status, 'blocked'); assert.equal(f.calls.length, 0);
});
test('successful preflight reads only and never pulls an image', async () => {
  const f = fixture(), report = await f.go({ ...settings, run: false });
  assert.equal(report.status, 'prerequisites-passed'); assert.equal(report.cleanup.status, 'not-created');
  assert.deepEqual(f.calls.map(c => c.args[0]), ['context','info','image']);
});
for (const env of [{ DOCKER_HOST: 'tcp://remote:2376' }, { DOCKER_HOST: 'unix:///different.sock' }, { DOCKER_CERT_PATH: '/certs' }])
  test(`Docker override is refused: ${Object.keys(env)[0]}`, async () => {
    const f = fixture({ dependencies: { env } }); assert.equal((await f.go()).status, 'blocked'); assert.equal(f.calls.length, 0);
  });
test('remote active Docker context is refused before creation', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'context' ? { status: 0, stdout: JSON.stringify([{ Endpoints: { docker: { Host: 'ssh://remote' } } }]) } : null });
  assert.equal((await f.go()).status, 'blocked'); assert.equal(f.calls.length, 1);
});
test('missing image is blocked, never pulled automatically', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'image' ? { status: 1, stderr: 'not found' } : null });
  assert.equal((await f.go()).status, 'blocked'); assert.ok(!f.calls.some(c => ['pull','create'].includes(c.args[0])));
});
test('successful run migrates only generated URLs, records actual image ID, and cleans only the owned container', async () => {
  const f = fixture(), report = await f.go(); assert.equal(report.status, 'requested-checks-passed');
  assert.equal(report.integration.passed, 17); assert.equal(report.fullBuild, 'not-requested'); assert.equal(report.image.id, IMAGE_ID); assert.equal(report.cleanup.status, 'removed');
  const create = f.calls.find(c => c.args[0] === 'create'); assert.equal(create.args.at(-1), IMAGE_ID);
  assert.ok(create.args.includes('127.0.0.1::5432')); assert.ok(create.args.includes('--tmpfs')); assert.ok(!create.args.join(' ').includes(f.c.adminPassword));
  const migrate = f.calls.find(c => c.args.includes('deploy')); assert.equal(new URL(migrate.opts.env.MIGRATION_DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(migrate.opts.env.NAVYIX_API_ENABLED, 'false');
  assert.deepEqual(f.calls.at(-1).args, ['rm', '--force', '--volumes', ID]);
  for (const secret of [f.c.adminPassword, f.c.runtimePassword, f.c.browserPassword]) assert.ok(!JSON.stringify(report).includes(secret));
  assert.ok(!f.calls.some(c => ['git','gh','npm','pnpm'].includes(c.command))); assert.ok(!f.calls.some(c => c.args.includes('prune')));
});
test('optional full checks run after strict database acceptance', async () => {
  const f = fixture(), report = await f.go({ ...settings, full: true });
  assert.equal(report.fullBuild, 'passed'); const check = f.calls.find(c => c.args[0] === 'scripts/verify-workspace.mjs'); assert.deepEqual(check.args, ['scripts/verify-workspace.mjs','--full']);
});
for (const point of ['start', 'port', 'psql', 'migrate', '--test', 'scripts/verify-workspace.mjs'])
  test(`failure at ${point} still cleans the owned database`, async () => {
    const f = fixture({ respond: (c,a) => a.includes(point) ? { status: 1, stderr: 'controlled failure' } : null });
    const report = await f.go({ ...settings, full: true }); assert.equal(report.status, 'failed'); assert.equal(report.cleanup.status, 'removed');
  });
test('wrong network binding fails before any migrations and is cleaned up', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'port' ? { status: 0, stdout: '0.0.0.0:55432' } : null });
  assert.equal((await f.go()).status, 'failed'); assert.ok(!f.calls.some(c => c.args.includes('migrate'))); assert.equal(f.calls.at(-1).args[0], 'rm');
});
test('zero-exit integration with skipped evidence is still a failure', async () => {
  const f = fixture({ respond: (c,a) => a.includes('--test') ? { status: 0, stdout: TAP.replace('# skipped 0','# skipped 2') } : null });
  assert.equal((await f.go()).status, 'failed');
});
test('cleanup label mismatch prevents deletion of an unrelated container', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'inspect' ? { status: 0, stdout: JSON.stringify([{ Id: ID, Config: { Labels: {} } }]) } : null });
  const report = await f.go(); assert.equal(report.status, 'failed'); assert.equal(report.cleanup.status, 'failed'); assert.ok(!f.calls.some(c => c.args[0] === 'rm'));
});
test('cleanup failure cannot masquerade as a passed run', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'rm' ? { status: 1, stderr: 'daemon lost' } : null });
  assert.equal((await f.go()).status, 'failed');
});
test('ambiguous create timeout is reconciled by unique label before cleanup', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'create' ? { status: null, error: 'Timed out', stdout: '' } : null });
  const report = await f.go(); assert.equal(report.status, 'failed'); assert.equal(report.cleanup.status, 'removed');
  assert.ok(f.calls.some(c => c.args[0] === 'container')); assert.equal(f.calls.at(-1).args.at(-1), ID);
});
test('ambiguous ownership cannot trigger broad deletion', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'create' ? { status: 1 } : a[0] === 'container' ? { status: 0, stdout: `${ID}\n${'c'.repeat(64)}` } : null });
  assert.equal((await f.go()).cleanup.status, 'failed'); assert.ok(!f.calls.some(c => c.args[0] === 'rm'));
});
test('interruption after creation still cleans up without the aborted signal', async () => {
  const controller = new AbortController();
  const f = fixture({ dependencies: { signal: controller.signal }, respond: (c,a) => {
    if (a[0] === 'start') { controller.abort(); return { status: 0, stdout: '' }; } return null;
  } });
  const report = await f.go(); assert.equal(report.status, 'interrupted'); assert.equal(report.cleanup.status, 'removed'); assert.equal(f.calls.at(-1).opts.signal, undefined);
});
test('child-runner executes real Node without a shell and captures output', async () => {
  const r = await runProcess(process.execPath, ['-e','process.stdout.write("ok");process.stderr.write("diagnostic")'], { env: isolatedEnvironment() });
  assert.equal(r.status, 0); assert.equal(r.stdout, 'ok'); assert.equal(r.stderr, 'diagnostic');
});
test('child-runner captures stdin without putting it in command arguments', async () => {
  const r = await runProcess(process.execPath, ['-e','process.stdin.on("data", b => process.stdout.write(b))'], { input: 'test-data', env: isolatedEnvironment() });
  assert.equal(r.stdout, 'test-data');
});
test('child-runner handles missing executables as explicit failures', async () => {
  const r = await runProcess('navyix-nonexistent-executable', [], { env: isolatedEnvironment() }); assert.equal(r.error, 'ENOENT');
});
test('child-runner times out and terminates the child process', async () => {
  const r = await runProcess(process.execPath, ['-e','setInterval(()=>{},1000)'], { timeout: 40, env: isolatedEnvironment() }); assert.equal(r.error, 'Timed out');
});
test('already-aborted child-runner does not start execution', async () => {
  const controller = new AbortController(); controller.abort();
  const r = await runProcess(process.execPath, ['-e','throw Error("should not execute")'], { signal: controller.signal }); assert.equal(r.error, 'Interrupted'); assert.equal(r.stdout, '');
});

test('Docker older than 28 is blocked before publishing a port', async () => {
  const f = fixture({ respond: (c,a) => a[0] === 'info' ? { status: 0, stdout: '27.5.1' } : null });
  const report = await f.go(); assert.equal(report.status, 'blocked'); assert.match(report.error, /28/); assert.ok(!f.calls.some(c => c.args[0] === 'create'));
});

test('report output cannot overwrite an existing file, even with --run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'navyix-report-test-'));
  const report = join(directory, 'existing.json'); writeFileSync(report, 'preserve me');
  try {
    const result = await runProcess(process.execPath, [fileURLToPath(new URL('../integration-lab.mjs', import.meta.url)), '--run', '--report', report], { env: isolatedEnvironment() });
    assert.equal(result.status, 1); assert.match(result.stderr, /already exists/); assert.equal(readFileSync(report, 'utf8'), 'preserve me');
    assert.ok(!result.stderr.includes('[Navyix acceptance]'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('container creation cannot auto-pull even if the inspected image disappears', async () => {
  const f = fixture(); await f.go(); const args = f.calls.find(c => c.args[0] === 'create').args;
  assert.equal(args[args.indexOf('--pull') + 1], 'never');
});
