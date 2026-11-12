import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = name => readFile(new URL('../../' + name, import.meta.url), 'utf8');
const lines = (await read('.dockerignore')).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
const browser = await read('apps/web/lib/browser.ts');

test('build context defaults to excluded and selectively includes required workspace roots', () => {
  assert.equal(lines[0], '**');
  for (const name of ['!package.json', '!pnpm-lock.yaml', '!pnpm-workspace.yaml', '!tsconfig.base.json', '!apps/api/**', '!apps/web/**', '!packages/**', '!scripts/**']) assert.ok(lines.includes(name));
});
test('secrets and local outputs remain excluded after broad source inclusions', () => {
  const lastSource = Math.max(...['!apps/api/**', '!apps/web/**', '!packages/**', '!scripts/**'].map(x => lines.indexOf(x)));
  for (const name of ['**/.env', '**/.env.*', '**/*.env', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/secrets/**', '**/node_modules/**', '**/.next/**', '**/dist/**', '**/public/workbench/**', '**/.git/**']) assert.ok(lines.indexOf(name) > lastSource, name);
  assert.deepEqual(lines.slice(lastSource + 1).filter(x => x.startsWith('!')), []);
});
test('registry configuration is never accepted from the build context', () => {
  assert.ok(lines.includes('**/.npmrc')); assert.ok(!lines.includes('!.npmrc'));
});
test('both image definitions require a lockfile and never copy registry credentials', async () => {
  for (const app of ['api', 'web']) {
    const docker = await read(`apps/${app}/Dockerfile`);
    assert.match(docker, /COPY package.json pnpm-workspace.yaml pnpm-lock.yaml/);
    assert.match(docker, /RUN pnpm install --frozen-lockfile/);
    assert.doesNotMatch(docker, /--no-frozen-lockfile|COPY[^\n]+\.npmrc/);
    assert.match(docker, /USER node/);
  }
});
test('API image code generation uses inert URLs with no migration or deployment step', async () => {
  const docker = await read('apps/api/Dockerfile');
  assert.match(docker, /DATABASE_URL=postgresql:\/\/127\.0\.0\.1:1\/navyix_codegen/);
  assert.doesNotMatch(docker, /db:migrate|migrate deploy|db push/);
  assert.match(docker, /NAVYIX_API_ENABLED=false/);
});
test('provider validation precedes database allocation and failures close the created pool', () => {
  assert.ok(browser.indexOf('oidcClient(config, jose)') < browser.indexOf('new Pool('));
  assert.match(browser, /try \{\s+await store\.assertSafe\(\);\s+return browserHandler/);
  assert.match(browser, /catch \(error\) \{\s+await pool\.end\(\);\s+throw error;/);
});
test('browser entry point delegates lifecycle and preserves production TLS/role validation', () => {
  assert.match(browser, /export const serveBrowser = createBrowserRuntime\(initialize/);
  assert.doesNotMatch(browser, /initialization = undefined/);
  assert.match(browser, /decodeURIComponent\(connection.username\) !== 'navyix_browser'/);
  assert.match(browser, /connection.searchParams.get\('sslmode'\) !== 'verify-full'/);
});
