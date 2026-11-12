/** Manual, disposable PostgreSQL/JOSE acceptance lab. No cloud, CI or customer database. */
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LABEL = 'io.navyix.acceptance.run';
const IMAGE = 'postgres:17-alpine';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HEX_ID = /^[a-f0-9]{64}$/;
const REQUIRED = [
  'pnpm-lock.yaml', 'apps/api/package.json', 'apps/web/package.json',
  'packages/browser-session/package.json', 'apps/api/prisma/schema.prisma',
  'apps/api/prisma/roles.sql', 'apps/api/prisma/browser-roles.sql',
  'packages/server/test/integration.test.mjs',
  'packages/server/test/team-live.test.mjs',
  'packages/server/test/journal-live.test.mjs',
  'packages/server/test/workflow-shape-live.test.mjs',
  'packages/server/test/directory-live.test.mjs',
  'packages/server/test/invitations-live.test.mjs',
  'packages/browser-session/test/integration.test.mjs',
  'packages/server/test/acceptance-live.test.mjs', 'scripts/verify-workspace.mjs'
];
const DEPENDENCIES = [
  ['apps/api', 'prisma'], ['apps/api', '@prisma/client'], ['apps/api', 'jose'],
  ['packages/browser-session', 'jose'], ['packages/browser-session', 'pg']
];
const fail = message => { throw new Error(message); };
export function options(args) {
  const result = { run: false, full: false, image: IMAGE, report: null };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) fail(`Repeated option: ${key}`);
    seen.add(key);
    if (key === '--run') result.run = true;
    else if (key === '--full') result.full = true;
    else if ((key === '--image' || key === '--report') && args[i + 1] && !args[i + 1].startsWith('--')) result[key.slice(2)] = args[++i];
    else fail('Usage: node scripts/integration-lab.mjs [--run] [--full] [--image postgres:17-alpine|postgres@sha256:DIGEST] [--report PATH]');
  }
  // No arbitrary third-party images, shell fragments or external database URLs.
  if (!/^postgres:(?:17)(?:\.\d+)?-alpine(?:\d+(?:\.\d+)?)?$/.test(result.image) && !/^postgres@sha256:[a-f0-9]{64}$/.test(result.image)) fail('Use an official PostgreSQL 17 Alpine tag or a reviewed postgres@sha256 digest.');
  if (result.full && !result.run) fail('--full requires --run. The default is a non-mutating preflight.');
  return result;
}
export function prerequisites(root, { version = process.versions.node, exists = existsSync, dependency } = {}) {
  const checks = [{ name: 'Node.js >= 22', passed: Number(version.split('.')[0]) >= 22 }];
  for (const file of REQUIRED) checks.push({ name: `File: ${file}`, passed: exists(resolve(root, file)) });
  for (const [directory, name] of DEPENDENCIES) {
    let passed = false;
    try { passed = Boolean(dependency ? dependency(directory, name) : createRequire(resolve(root, directory, 'package.json')).resolve(name)); } catch { /* Explicitly blocked, never silently skipped. */ }
    checks.push({ name: `Installed: ${directory} → ${name}`, passed });
  }
  return checks;
}
export function isolatedEnvironment(source = process.env) {
  const out = {};
  // Preserve only execution essentials. Never inherit customer DB URLs, cloud/model keys or enable flags.
  const allowed = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|LANG|LC_ALL|DOCKER_CONFIG|DOCKER_CONTEXT|TERM)$/i;
  for (const [key, value] of Object.entries(source)) if (allowed.test(key) && typeof value === 'string') out[key] = value;
  return { ...out, CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NAVYIX_API_ENABLED: 'false', NAVYIX_BROWSER_ENABLED: 'false' };
}
export function credentials(runId = randomUUID()) {
  if (!UUID.test(runId)) fail('Invalid lab run identifier.');
  return { runId, name: `navyix-acceptance-${runId}`, database: 'navyix_acceptance',
    adminPassword: randomBytes(32).toString('hex'), runtimePassword: randomBytes(32).toString('hex'), browserPassword: randomBytes(32).toString('hex') };
}
export function redact(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\bpostgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[DATABASE_URL_REDACTED]')
    .replace(/((?:password|secret|access_token|id_token|refresh_token)["']?\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
export function sanitize(value, secrets = []) {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, secrets)]));
  return value;
}
export function localEndpoint(host) {
  return typeof host === 'string' && (host.startsWith('unix:///') || host.startsWith('npipe:////./pipe/'));
}
export function databasePort(output) {
  const value = String(output).trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(value);
  const port = match && Number(match[1]);
  if (!port || port > 65535) fail('Disposable PostgreSQL was not bound exclusively to 127.0.0.1.');
  return port;
}
export function databaseEnvironment(c, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid local database port.');
  const url = (user, password) => `postgresql://${user}:${password}@127.0.0.1:${port}/${c.database}?sslmode=disable`;
  const admin = url('postgres', c.adminPassword), runtime = url('navyix_app', c.runtimePassword), browser = url('navyix_browser', c.browserPassword);
  return { DATABASE_URL: runtime, MIGRATION_DATABASE_URL: admin,
    NAVYIX_TEST_DATABASE_URL: runtime, NAVYIX_TEST_ADMIN_URL: admin, NAVYIX_TEST_BROWSER_DATABASE_URL: browser,
    NAVYIX_TEST_DB_CONFIRM: 'disposable', NAVYIX_REQUIRE_INTEGRATION: '1', NAVYIX_REQUIRE_BROWSER_INTEGRATION: '1',
    NAVYIX_LAB_RUN_ID: c.runId, NAVYIX_API_ENABLED: 'false', NAVYIX_BROWSER_ENABLED: 'false' };
}
export function tapSummary(text) {
  const number = key => {
    const values = [...String(text).matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, 'gm'))];
    return values.length === 1 ? Number(values[0][1]) : null;
  };
  const out = { tests: number('tests'), passed: number('pass'), failed: number('fail'), skipped: number('skipped'), cancelled: number('cancelled') };
  if (Object.values(out).some(value => value === null) || out.tests < 1 || out.passed < 1 || out.failed || out.skipped || out.cancelled || out.passed !== out.tests) fail('Strict integration did not report a complete, nonempty, zero-skip passing TAP summary.');
  return out;
}
/** Captures output; never streams secret-bearing child stdout/stderr to a terminal. */
export function runProcess(command, args, { cwd, env, input, timeout = 120_000, signal } = {}) {
  return new Promise(resolveResult => {
    if (signal?.aborted) { resolveResult({ status: null, error: 'Interrupted', stdout: '', stderr: '' }); return; }
    let stdout = '', stderr = '', settled = false, overflow = false, timedOut = false, interrupted = false;
    let timer;
    const child = spawn(command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const terminate = () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          // PID is the child we created, never a caller-supplied identifier.
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          killer.on('error', () => child.kill());
        } else process.kill(-child.pid, 'SIGKILL');
      } catch { child.kill('SIGKILL'); }
    };
    const abort = () => { interrupted = true; terminate(); };
    const done = result => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolveResult({ stdout, stderr, ...result });
    };
    timer = setTimeout(() => { timedOut = true; terminate(); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const capture = (kind, data) => {
      if (overflow) return;
      if (kind === 'stdout') stdout += data.toString(); else stderr += data.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 8_000_000) { overflow = true; terminate(); }
    };
    child.stdout.on('data', data => capture('stdout', data)); child.stderr.on('data', data => capture('stderr', data));
    child.stdin.on('error', () => {});
    child.once('error', error => done({ status: null, error: error.code || 'Spawn failed' }));
    child.once('close', status => done({ status, error: interrupted ? 'Interrupted' : timedOut ? 'Timed out' : overflow ? 'Output limit exceeded' : null }));
    child.stdin.end(input || '');
  });
}
export async function execute(root, settings, dependencies = {}) {
  const { run = runProcess, read = readFileSync, resolvePackage = (directory, name) => createRequire(resolve(root, directory, 'package.json')).resolve(name),
    sleep = ms => new Promise(done => setTimeout(done, ms)), signal, env = process.env, progress = () => {}, makeCredentials = credentials } = dependencies;
  const checks = dependencies.checks ?? prerequisites(root);
  const report = { schemaVersion: 1, scope: 'disposable-postgresql-and-real-jose', startedAt: new Date().toISOString(),
    status: 'blocked', checks, steps: [], cleanup: { status: 'not-created' },
    remaining: ['Live identity-provider login and cookie/session browser behavior', 'Two-organization rendered browser workflow', 'Container app builds', 'Security, load and recovery acceptance'] };
  let c, containerId, safeEnv, secrets = [], completed = false, createAttempted = false;
  const finish = () => { report.finishedAt = new Date().toISOString(); return sanitize(report, secrets); };
  const step = async (name, command, args, configuration = {}, { optional = false, cleanup = false } = {}) => {
    if (!cleanup && signal?.aborted) fail('Interrupted.');
    progress(name);
    let result;
    try { result = await run(command, args, { cwd: root, env: safeEnv, timeout: 120_000, signal: cleanup ? undefined : signal, ...configuration }); }
    catch (error) { result = { status: null, error: error.message, stdout: '', stderr: '' }; }
    const passed = result.status === 0 && !result.error;
    report.steps.push({ name, status: passed ? 'passed' : optional ? 'pending' : 'failed', exitCode: result.status ?? null,
      ...(passed ? {} : { diagnostic: redact(result.error || result.stderr || result.stdout || 'Command failed', secrets).slice(-3000) }) });
    if (!passed && !optional) fail(`${name} failed.`);
    return result;
  };
  try {
    if (checks.some(check => !check.passed)) return finish();
    // Docker may be configured to control another host. Never mutate a remote daemon.
    if (env.DOCKER_HOST && !localEndpoint(env.DOCKER_HOST)) { checks.push({ name: 'Local Docker endpoint (remote DOCKER_HOST refused)', passed: false }); return finish(); }
    if (env.DOCKER_HOST) { checks.push({ name: 'Use a named local Docker context instead of DOCKER_HOST override', passed: false }); return finish(); }
    if (env.DOCKER_TLS_VERIFY || env.DOCKER_CERT_PATH) { checks.push({ name: 'No remote Docker TLS overrides', passed: false }); return finish(); }
    safeEnv = isolatedEnvironment(env);
    const context = JSON.parse((await step('Inspect local Docker context', 'docker', ['context', 'inspect'])).stdout);
    if (!Array.isArray(context) || context.length !== 1 || !localEndpoint(context[0]?.Endpoints?.docker?.Host)) fail('Docker context is not a local Unix socket or Windows named pipe.');
    report.dockerContext = String(context[0].Name || 'local');
    const engine = (await step('Docker daemon available', 'docker', ['info', '--format', '{{.ServerVersion}}'])).stdout.trim();
    if (!/^\d+\.\d+\.\d+/.test(engine) || Number(engine.split('.')[0]) < 28) fail('Docker Engine 28+ is required for the loopback publishing security fix.');
    report.dockerEngine = engine;
    const inspected = await step('Reviewed PostgreSQL image available locally', 'docker', ['image', 'inspect', settings.image]);
    const image = JSON.parse(inspected.stdout);
    if (!Array.isArray(image) || image.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(image[0]?.Id)) fail('Could not identify a local PostgreSQL image.');
    report.image = { requested: settings.image, id: image[0].Id, repoDigests: image[0].RepoDigests || [] };
    if (!settings.run) { report.status = 'prerequisites-passed'; return finish(); }
    c = makeCredentials(); secrets = [c.adminPassword, c.runtimePassword, c.browserPassword];
    report.runId = c.runId; report.containerName = c.name;
    createAttempted = true;
    const result = await step('Create isolated database container', 'docker', ['create', '--pull', 'never', '--name', c.name, '--label', `${LABEL}=${c.runId}`,
      '--publish', '127.0.0.1::5432', '--memory', '768m', '--cpus', '1', '--pids-limit', '256',
      '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=268435456',
      '--env', 'POSTGRES_DB', '--env', 'POSTGRES_USER', '--env', 'POSTGRES_PASSWORD', image[0].Id],
      { env: { ...safeEnv, POSTGRES_DB: c.database, POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: c.adminPassword } });
    containerId = result.stdout.trim();
    if (!HEX_ID.test(containerId)) fail('Invalid container ID; no unverified container will be removed.');
    report.cleanup = { status: 'required' };
    await step('Start disposable PostgreSQL', 'docker', ['start', containerId]);
    const port = databasePort((await step('Verify loopback-only database binding', 'docker', ['port', containerId, '5432/tcp'])).stdout);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const health = await step(`PostgreSQL readiness ${attempt + 1}`, 'docker', ['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', c.database], { timeout: 5000 }, { optional: true });
      if (health.status === 0 && !health.error) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) fail('Disposable PostgreSQL did not become ready.');
    const psql = async (name, sql) => step(name, 'docker', ['exec', '-i', containerId, 'psql', '-X', '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', c.database], { input: sql });
    await psql('Create restricted runtime and browser roles', read(resolve(root, 'apps/api/prisma/roles.sql'), 'utf8') + '\n' + read(resolve(root, 'apps/api/prisma/browser-roles.sql'), 'utf8'));
    await psql('Assign per-run disposable credentials', `ALTER ROLE navyix_app PASSWORD '${c.runtimePassword}';\nALTER ROLE navyix_browser PASSWORD '${c.browserPassword}';\n`);
    const databaseEnv = { ...safeEnv, ...databaseEnvironment(c, port) };
    // Direct CLI invocation bypasses any wrapper that loads a developer .env. No package install.
    const prisma = resolvePackage('apps/api', 'prisma'), schema = resolve(root, 'apps/api/prisma/schema.prisma');
    for (const [name, args] of [
      ['Validate Prisma schema', ['validate']], ['Generate Prisma client', ['generate']], ['Migrate only the disposable database', ['migrate', 'deploy']]
    ]) await step(name, process.execPath, [prisma, ...args, '--schema', schema], { env: databaseEnv, timeout: 180_000 });
    const integrations = await step('Execute real JOSE and two-organization PostgreSQL acceptance', process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap', 'packages/server/test/integration.test.mjs',
        'packages/browser-session/test/integration.test.mjs', 'packages/server/test/acceptance-live.test.mjs',
        'packages/server/test/team-live.test.mjs', 'packages/server/test/journal-live.test.mjs',
        'packages/server/test/workflow-shape-live.test.mjs', 'packages/server/test/directory-live.test.mjs', 'packages/server/test/invitations-live.test.mjs'],
      { env: databaseEnv, timeout: 240_000 });
    report.integration = tapSummary(integrations.stdout);
    if (settings.full) {
      await step('Full build, typecheck, lint and regression gate', process.execPath, ['scripts/verify-workspace.mjs', '--full'], { env: databaseEnv, timeout: 900_000 });
      report.fullBuild = 'passed';
    } else report.fullBuild = 'not-requested';
    completed = true; report.status = 'requested-checks-passed';
  } catch (error) {
    report.status = signal?.aborted ? 'interrupted' : report.runId ? 'failed' : 'blocked';
    report.error = redact(error.message, secrets);
  } finally {
    // A create response can be lost after Docker created the container. Reconcile by our
    // unpredictable per-run name AND label; never blindly remove by name or run docker prune.
    if (createAttempted && (!containerId || !HEX_ID.test(containerId))) {
      try {
        const found = await step('Reconcile uncertain container creation', 'docker', ['container', 'ls', '--all', '--no-trunc', '--filter', `label=${LABEL}=${c.runId}`, '--format', '{{.ID}}'], { timeout: 20_000 }, { cleanup: true });
        const ids = found.stdout.trim().split(/\s+/).filter(Boolean);
        if (!ids.length) report.cleanup = { status: 'not-created' };
        else if (ids.length === 1 && HEX_ID.test(ids[0])) containerId = ids[0];
        else fail('Ambiguous container ownership; automatic removal refused.');
      } catch (error) { report.cleanup = { status: 'failed', error: redact(error.message, secrets) }; report.status = 'failed'; }
    }
    if (containerId && HEX_ID.test(containerId)) {
      try {
        const inspection = await step('Verify ownership before cleanup', 'docker', ['inspect', containerId], { timeout: 20_000 }, { cleanup: true });
        const container = JSON.parse(inspection.stdout);
        if (!Array.isArray(container) || container.length !== 1 || container[0]?.Id !== containerId || container[0]?.Config?.Labels?.[LABEL] !== c.runId) fail('Container ownership label mismatch. Automatic removal refused.');
        await step('Remove only this run’s disposable container and anonymous volumes', 'docker', ['rm', '--force', '--volumes', containerId], { timeout: 30_000 }, { cleanup: true });
        report.cleanup = { status: 'removed', containerId };
      } catch (error) { report.cleanup = { status: 'failed', containerId, error: redact(error.message, secrets) }; report.status = 'failed'; }
    }
    // A failed cleanup cannot be reported as a passed acceptance run.
    if (completed && report.cleanup.status !== 'removed') report.status = 'failed';
  }
  return finish();
}
