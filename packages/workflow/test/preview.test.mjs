import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
let server;
const port = 14173;
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('../../../scripts/preview-workflow.mjs', import.meta.url))], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(server.stdout, 'data'), new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Preview startup timed out')), 5000); t.unref(); })]);
});
after(() => server?.kill());
const request = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
test('preview serves HTML with restrictive CSP', async () => { const r = await request('/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(r.headers.get('content-security-policy'), /connect-src 'none'/); assert.match(await r.text(), /navyix-workbench/); });
test('preview serves canonical domain module', async () => { const r = await request('/workflow.mjs'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/); assert.match(await r.text(), /assessProject/); });
test('preview does not expose repository configuration', async () => assert.equal((await request('/package.json')).status, 404));
test('preview rejects writes', async () => assert.equal((await request('/', { method: 'POST' })).status, 405));
test('preview rejects foreign Host headers', async () => {
  const status = await new Promise((resolve, reject) => { const req = httpRequest({ hostname: '127.0.0.1', port, path: '/', headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(status, 403);
});
test('preview HEAD has no body', async () => { const r = await request('/app.mjs', { method: 'HEAD' }); assert.equal(r.status, 200); assert.equal(await r.text(), ''); });
