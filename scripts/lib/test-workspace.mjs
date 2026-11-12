/** Explicit test discovery and result accounting. Does not install, deploy or dispatch CI. */
import { readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from 'node:test';

export const GROUPS = Object.freeze({
  policy: 'packages/policy/test',
  workflow: 'packages/workflow/test',
  server: 'packages/server/test',
  browser: 'packages/browser-session/test',
  tooling: 'scripts/test'
});
const fail = message => { throw new Error(message); };
const contained = (root, path) => {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};
export function options(args) {
  const value = { groups: [], integration: false, list: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--group' && Object.hasOwn(GROUPS, args[i + 1] || '')) {
      const group = args[++i];
      if (value.groups.includes(group)) fail('Duplicate test group.');
      value.groups.push(group);
    } else if (args[i] === '--integration' && !value.integration) value.integration = true;
    else if (args[i] === '--list' && !value.list) value.list = true;
    else fail('Usage: node scripts/test-workspace.mjs [--group policy|workflow|server|browser|tooling] [--integration] [--list]');
  }
  if (!value.groups.length) value.groups = Object.keys(GROUPS);
  return value;
}
export function supportedNode(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return Boolean(match && (+match[1] > 22 || (+match[1] === 22 && +match[2] >= 16)));
}
export function executionEnvironment(env, integration) {
  const next = { ...env };
  // A test runner must not inherit the Node test-child protocol or filtering flags.
  delete next.NODE_TEST_CONTEXT;
  if (!integration) {
    for (const key of Object.keys(next)) if (key.startsWith('NAVYIX_TEST_') || key.startsWith('NAVYIX_REQUIRE_')) delete next[key];
  } else {
    if (next.NAVYIX_TEST_DB_CONFIRM !== 'disposable') fail('Strict integration requires NAVYIX_TEST_DB_CONFIRM=disposable.');
    for (const key of ['NAVYIX_TEST_DATABASE_URL', 'NAVYIX_TEST_ADMIN_URL', 'NAVYIX_TEST_BROWSER_DATABASE_URL']) {
      try {
        const url = new URL(next[key]);
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') throw new Error();
      } catch { fail(`Strict integration requires a valid ${key}; its value is never printed.`); }
    }
    next.NAVYIX_REQUIRE_INTEGRATION = '1';
    next.NAVYIX_REQUIRE_BROWSER_INTEGRATION = '1';
  }
  return next;
}

/** All groups must exist. In Git checkouts, missing tracked tests also fail preflight. */
export function discover(root, groups, { git = spawnSync } = {}) {
  root = realpathSync(root);
  if (!Array.isArray(groups) || !groups.length || new Set(groups).size !== groups.length || groups.some(g => !Object.hasOwn(GROUPS, g))) fail('Select valid, distinct test groups.');
  const files = [], byGroup = {};
  function walk(directory, group) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`Symlinks are not allowed in test trees: ${relative(root, path)}`);
      if (entry.isDirectory()) walk(path, group);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        if (!contained(root, realpathSync(path))) fail('Test path escapes the checkout.');
        files.push(path); byGroup[group].push(path);
      }
    }
  }
  for (const group of groups) {
    const directory = resolve(root, GROUPS[group]);
    if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) fail(`Missing test directory: ${GROUPS[group]}`);
    if (!contained(root, realpathSync(directory))) fail('Test directory escapes the checkout.');
    byGroup[group] = []; walk(directory, group);
    if (!byGroup[group].length) fail(`No test files in required group: ${group}`);
  }
  let inventory = 'filesystem-only';
  if (existsSync(resolve(root, '.git'))) {
    const result = git('git', ['-C', root, 'ls-files', '-z', '--', ...groups.map(g => GROUPS[g])], { encoding: 'utf8', shell: false, timeout: 10000, maxBuffer: 4_000_000 });
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') fail('Cannot verify tracked test inventory.');
    const found = new Set(files);
    for (const path of result.stdout.split('\0').filter(p => p.endsWith('.test.mjs'))) {
      const absolute = resolve(root, path);
      if (!contained(root, absolute) || !found.has(absolute)) fail(`Missing tracked test file: ${path}`);
    }
    inventory = 'tracked-tests-checked';
  }
  return { root, groups, files, byGroup, inventory };
}

export function evaluate(plan, summaries, final, failures, integration) {
  const issues = [...failures];
  let actualTests = 0, skipped = 0, todo = 0;
  for (const file of plan.files) {
    const summary = summaries.get(file);
    if (!summary || !Number.isSafeInteger(summary.counts?.tests) || summary.counts.tests < 1) issues.push(`No declared tests executed: ${relative(plan.root, file)}`);
    else {
      actualTests += summary.counts.tests;
      skipped += summary.counts.skipped || 0; todo += summary.counts.todo || 0;
      if (summary.success !== true || summary.counts.failed || summary.counts.cancelled) issues.push(`Unsuccessful test file: ${relative(plan.root, file)}`);
    }
  }
  if (!final || final.success !== true || final.counts?.failed || final.counts?.cancelled) issues.push('Runner did not complete successfully.');
  if (!actualTests) issues.push('Zero declared tests cannot pass.');
  if (todo) issues.push('TODO tests are not accepted by this gate.');
  if (integration && skipped) issues.push('Strict integration does not permit skipped tests.');
  return {
    status: issues.length ? 'failed' : skipped ? 'passed-with-skips' : 'passed',
    scope: integration ? 'strict-integration-and-regression' : 'local-regression',
    inventory: plan.inventory, groups: plan.groups, files: plan.files.length,
    counts: final?.counts || null, declaredTests: actualTests, skipped, todo, issues: [...new Set(issues)]
  };
}

/** Node >=22.16 provides per-file and final test:summary events used for accounting. */
export async function execute(plan, { integration = false, runner = run, output = () => {} } = {}) {
  const summaries = new Map(), failures = [];
  let final;
  try {
    const stream = runner({ files: plan.files, concurrency: 1, timeout: 120000 });
    for await (const event of stream) {
      const data = event.data;
      if (event.type === 'test:summary') {
        if (data.file) summaries.set(resolve(data.file), data);
        else final = data;
      } else if (event.type === 'test:fail') {
        const file = data.file ? relative(plan.root, data.file) : 'unknown file';
        failures.push(`${file}: ${data.name}`);
        output(`FAIL ${file}: ${data.name}`);
      } else if (event.type === 'test:stdout' || event.type === 'test:stderr') output(data.message);
    }
  } catch { failures.push('The Node test runner failed before completion.'); }
  return evaluate(plan, summaries, final, failures, integration);
}
