/** Explicit local verification. Never installs, migrates, dispatches CI, pushes or deploys. */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GROUPS, discover, supportedNode, executionEnvironment } from './lib/test-workspace.mjs';

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
  return [
    // Use the existing wrapper: it loads the same optional root .env as the API.
    { name: 'Prisma schema', command: 'pnpm', args: ['--filter', '@navyix/api', 'db:validate'] },
    { name: 'Prisma client', command: 'pnpm', args: ['--filter', '@navyix/api', 'db:generate'] },
    { name: 'TypeScript', command: 'pnpm', args: ['typecheck'] },
    { name: 'Lint', command: 'pnpm', args: ['lint'] },
    { name: integration ? 'Strict workspace regression' : 'Workspace regression', command: 'node',
      args: ['scripts/test-workspace.mjs', ...(integration ? ['--integration'] : [])] },
    { name: 'Framework builds', command: 'pnpm', args: ['build'] }
  ];
}
export function preflight(root, { nodeVersion = process.versions.node, exists = existsSync, dependency,
  inventory = directory => discover(directory, Object.keys(GROUPS)) } = {}) {
  const checks = [{ name: 'Node.js >= 22.16', passed: supportedNode(nodeVersion) }];
  for (const file of ['pnpm-lock.yaml', 'apps/web/package.json', 'apps/api/package.json', 'packages/browser-session/package.json', 'scripts/test-workspace.mjs']) {
    checks.push({ name: `File: ${file}`, passed: exists(resolve(root, file)) });
  }
  for (const [dir, pkg] of [['apps/web', 'next'], ['apps/web', 'pg'], ['apps/api', '@nestjs/core'], ['apps/api', '@prisma/client'], ['apps/api', 'prisma'], ['apps/api', '@typescript-eslint/parser'], ['packages/browser-session', 'jose']]) {
    let passed = false;
    try { passed = dependency ? dependency(dir, pkg) : Boolean(createRequire(resolve(root, dir, 'package.json')).resolve(pkg)); } catch { /* Unmet prerequisite. */ }
    checks.push({ name: `Installed: ${dir} → ${pkg}`, passed });
  }
  try {
    const value = inventory(root);
    checks.push({ name: 'All required test groups present', passed: Boolean(value?.files?.length) });
  } catch { checks.push({ name: 'All required test groups present', passed: false }); }
  return checks;
}
export function execute(root, settings, { checks = preflight(root), env = process.env, run = spawnSync } = {}) {
  const report = { scope: settings.integration ? 'local-build-and-strict-integration' : settings.full ? 'local-build' : 'prerequisites-only',
    checkedAt: new Date().toISOString(), checks: [...checks], steps: [], status: 'blocked',
    remaining: ['Live provider login', 'Two-organization deployed browser tests', 'Container builds', 'Security/load/recovery acceptance'] };
  if (checks.some(check => !check.passed)) return report;
  if (settings.integration) {
    try { executionEnvironment(env, true); }
    catch { report.checks.push({ name: 'Explicit disposable database confirmation and all three test URLs', passed: false }); return report; }
  }
  const steps = plan(settings);
  if (!steps.length) { report.status = 'prerequisites-passed'; return report; }
  for (const step of steps) {
    const command = step.command === 'node' ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    // Windows shell execution is limited to fixed pnpm arguments from plan().
    const result = run(command, step.args, { cwd: root, env: { ...env }, stdio: 'inherit',
      shell: process.platform === 'win32' && step.command === 'pnpm', timeout: 900_000 });
    report.steps.push({ name: step.name, status: !result.error && result.status === 0 ? 'passed' : 'failed', exitCode: result.status ?? null });
    if (result.error || result.status !== 0) { report.status = 'failed'; return report; }
  }
  report.status = 'requested-local-checks-passed';
  if (!settings.integration) report.remaining.unshift('Skipped live integrations: inspect the workspace test summary');
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const settings = options(process.argv.slice(2)), root = fileURLToPath(new URL('../', import.meta.url));
    const report = execute(root, settings);
    if (settings.report) { const file = resolve(settings.report); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'blocked') console.error('Resolve missing source, dependency and lockfile prerequisites. Nothing was installed or deployed.');
    process.exitCode = report.status === 'blocked' ? 2 : report.status === 'failed' ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
