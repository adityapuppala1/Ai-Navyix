import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { supportedNode } from '../lib/test-workspace.mjs';
const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('package.json'));
const api = JSON.parse(read('apps/api/package.json'));

test('package test command uses explicit cross-platform discovery', () => {
  assert.equal(manifest.scripts.test, 'node scripts/test-workspace.mjs');
  for (const name of ['test:workflow', 'test:server', 'test:tooling']) assert.doesNotMatch(manifest.scripts[name], /\*/);
});
test('minimum runtime matches test summary support', () => {
  assert.equal(manifest.engines.node, '>=22.16.0'); assert.equal(supportedNode('22.16.0'), true);
});
test('API owns its TypeScript parser dependency rather than relying on web transitive packages', () => {
  assert.equal(api.devDependencies['@typescript-eslint/parser'], '^8.0.0');
  assert.match(read('apps/api/eslint.config.mjs'), /parser: tsParser/);
  assert.match(read('apps/api/eslint.config.mjs'), /'no-eval': 'error'/);
});
test('web ignores generated assets but retains canonical workbench linting', () => {
  const config = read('apps/web/eslint.config.mjs');
  assert.match(config, /'public\/workbench\/\*\*'/); assert.match(config, /'\.next\/\*\*'/);
  assert.doesNotMatch(config, /['"]workbench\/\*\*['"]/);
  assert.match(config, /next\/core-web-vitals/); assert.match(config, /next\/typescript/);
});
test('Prisma validation uses the declared environment-loading wrapper', () => {
  assert.equal(api.scripts['db:validate'], 'node scripts/prisma.mjs validate');
});
test('real API lint parses typed decorators and catches forbidden constructs when dependencies are installed', async t => {
  const require = createRequire(resolve(root, 'apps/api/package.json'));
  let ESLint;
  try { require.resolve('@typescript-eslint/parser'); ({ ESLint } = require('eslint')); }
  catch (error) {
    if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
    if (process.env.NAVYIX_REQUIRE_INTEGRATION === '1') throw new Error('The declared API ESLint/parser dependencies are required for strict acceptance.');
    t.skip('ESLint/parser unavailable; actual lint execution is not verified.'); return;
  }
  // Import the actual repository configuration; do not substitute a test parser.
  const config = (await import(pathToFileURL(resolve(root, 'apps/api/eslint.config.mjs')).href)).default;
  const eslint = new ESLint({ cwd: resolve(root, 'apps/api'), overrideConfigFile: true, overrideConfig: config });
  const valid = `function Component(): ClassDecorator { return () => {}; }
    @Component() class Example { greet(name: string): string { return name; } } void Example;`;
  const [good] = await eslint.lintText(valid, { filePath: 'src/lint-acceptance.ts' });
  assert.equal(good.errorCount, 0, JSON.stringify(good.messages));
  const [bad] = await eslint.lintText('const value: string = "x"; debugger; eval(value);', { filePath: 'src/lint-acceptance.ts' });
  assert.ok(bad.messages.some(m => m.ruleId === 'no-debugger'));
  assert.ok(bad.messages.some(m => m.ruleId === 'no-eval'));
});
