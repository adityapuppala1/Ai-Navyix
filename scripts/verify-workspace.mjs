/** Explicit local verification only. Never installs packages, migrates databases, dispatches CI or deploys. */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function options(args) {
  const out = { full: false, integration: false, report: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') out.full = true;
    else if (args[i] === '--integration') { out.full = true; out.integration = true; }
    else if (args[i] === '--report' && args[i + 1] && !args[i + 1].startsWith('--')) out.report = args[++i];
    else throw new Error('Usage: node scripts/verify-workspace.mjs [--full | --integration] [--report PATH]');
  }
  return out;
}
export function plan({ full, integration }) {
  if (!full) return [];
  const steps = [
    { name: 'Prisma schema', command: 'pnpm', args: ['--filter', '@navyix/api', 'exec', 'prisma', 'validate'] },
    { name: 'Prisma client', command: 'pnpm', args: ['--filter', '@navyix/api', 'db:generate'] },
    { name: 'TypeScript', command: 'pnpm', args: ['typecheck'] },
    { name: 'Lint', command: 'pnpm', args: ['lint'] },
    { name: 'Regression tests', command: 'pnpm', args: ['test'] },
    { name: 'Framework builds', command: 'pnpm', args: ['build'] }
  ];
  if (integration) steps.push(
    { name: 'Server integration', command: 'node', args: ['--test', 'packages/server/test/integration.test.mjs'], env: { NAVYIX_REQUIRE_INTEGRATION: '1' } },
    { name: 'Session integration', command: 'node', args: ['scripts/test-browser.mjs', '--integration'] }
  );
  return steps;
}
export function preflight(root, { nodeVersion = process.versions.node, exists = existsSync, dependency } = {}) {
  const checks = [{ name: 'Node.js >= 22', passed: Number(nodeVersion.split('.')[0]) >= 22 }];
  for (const file of ['pnpm-lock.yaml', 'apps/web/package.json', 'apps/api/package.json', 'packages/browser-session/package.json']) {
    checks.push({ name: `File: ${file}`, passed: exists(resolve(root, file)) });
  }
  for (const [dir, pkg] of [['apps/web', 'next'], ['apps/web', 'pg'], ['apps/api', '@nestjs/core'], ['apps/api', '@prisma/client'], ['apps/api', 'prisma'], ['packages/browser-session', 'jose']]) {
    let passed = false;
    try { passed = dependency ? dependency(dir, pkg) : Boolean(createRequire(resolve(root, dir, 'package.json')).resolve(pkg)); } catch { /* Missing package is an unmet prerequisite. */ }
    checks.push({ name: `Installed: ${dir} → ${pkg}`, passed });
  }
  return checks;
}
export function execute(root, settings, { checks = preflight(root), env = process.env, run = spawnSync } = {}) {
  const report = { scope: settings.integration ? 'local-build-and-strict-integration' : settings.full ? 'local-build' : 'prerequisites-only',
    checkedAt: new Date().toISOString(), checks, steps: [], status: 'blocked', remaining: ['Live provider login', 'Two-organization deployed browser tests', 'Container builds', 'Security/load/recovery acceptance'] };
  if (checks.some(check => !check.passed)) return report;
  if (settings.integration && env.NAVYIX_TEST_DB_CONFIRM !== 'disposable') {
    report.checks.push({ name: 'Explicit disposable-database confirmation', passed: false }); return report;
  }
  const steps = plan(settings);
  if (!steps.length) { report.status = 'prerequisites-passed'; return report; }
  for (const step of steps) {
    const command = step.command === 'node' ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    // Windows command arguments are fixed by plan(), never read from user input.
    const result = run(command, step.args, { cwd: root, env: { ...env, ...step.env }, stdio: 'inherit',
      shell: process.platform === 'win32' && step.command === 'pnpm', timeout: 900_000 });
    report.steps.push({ name: step.name, status: !result.error && result.status === 0 ? 'passed' : 'failed', exitCode: result.status ?? null });
    if (result.error || result.status !== 0) { report.status = 'failed'; return report; }
  }
  report.status = 'requested-local-checks-passed'; return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const settings = options(process.argv.slice(2)), root = fileURLToPath(new URL('../', import.meta.url));
    const report = execute(root, settings);
    if (settings.report) { const file = resolve(settings.report); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'blocked') console.error('Resolve prerequisites on a network-enabled developer machine; generate/review a real lockfile. Nothing was installed or deployed.');
    process.exitCode = report.status === 'blocked' ? 2 : report.status === 'failed' ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
