/** TEST ONLY. Real browser/session HTTP; synthetic IdP, memory sessions and API.
 * Not Nest, PostgreSQL, external OIDC, RBAC validation or a deployment command.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserConfig } from '../../packages/browser-session/src/config.mjs';
import { browserHandler } from '../../packages/browser-session/src/handler.mjs';
import { MemorySessions, env } from '../../packages/browser-session/test/support/fixtures.mjs';
import { createProject, applyCommand, assessProject, reportTemplate } from '../../packages/workflow/src/workflow.mjs';

if (process.env.NAVYIX_TEST_HARNESS !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Set NAVYIX_TEST_HARNESS=1 in a non-production environment. Synthetic tests only.');
}
const root = new URL('../../', import.meta.url);
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ORG_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const organizations = new Map([[ORG_A, new Map()], [ORG_B, new Map()]]);
const receipts = new Map(), revoked = new Set(), readOnly = new Set();
const controlKey = randomBytes(24).toString('hex');
const token = randomBytes(24).toString('hex');
let dropAfterCommit = false, clockOffset = 0, handle, origin;
const calls = [];
const assets = new Map([
  ['app.mjs', 'apps/web/workbench/app.mjs'], ['connected.mjs', 'apps/web/workbench/connected.mjs'],
  ['connected.css', 'apps/web/workbench/connected.css'], ['workbench.css', 'apps/web/workbench/workbench.css'],
  ['client.mjs', 'packages/browser-session/src/client.mjs'], ['workflow.mjs', 'packages/workflow/src/workflow.mjs'],
  ['storage.mjs', 'packages/workflow/src/storage.mjs']
]);
const now = () => Date.now() + clockOffset;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const fail = (status, message, code = 'FIXTURE_ERROR') => json({ error: { code, message } }, status);
async function backend(url, init) {
  if (init.headers.authorization !== `Bearer ${token}`) return fail(401, 'Fixture authentication failed.');
  const u = new URL(url), parts = u.pathname.split('/').filter(Boolean);
  const orgId = parts[2], projectId = parts[4], operation = parts[5];
  calls.push({ path: u.pathname, method: init.method, key: init.headers['idempotency-key'] || null });
  const projects = organizations.get(orgId);
  if (!projects || revoked.has(orgId)) return fail(404, 'Access unavailable.', 'NOT_FOUND');
  const p = projects.get(projectId);
  if (init.method === 'GET') {
    if (!projectId) return json({ projects: [...projects.values()].map(({ id, name, revision }) => ({ id, name, revision })), next: null });
    if (!p) return fail(404, 'Unknown project.');
    if (operation === 'readiness') return json(assessProject(p, Object.fromEntries(u.searchParams), now()));
    if (operation === 'report-template') return json(reportTemplate(p, u.searchParams.get('buildId'), now()));
    if (operation === 'assessments') return json(p.assessments.find(a => a.id === parts[6]));
    return json(p);
  }
  if (readOnly.has(orgId)) return fail(403, 'This test membership is read-only.', 'FORBIDDEN');
  const key = `${orgId}:${init.headers['idempotency-key']}`, body = JSON.parse(init.body);
  if (receipts.has(key)) return json(receipts.get(key));
  let next;
  try {
    if (!projectId) next = createProject(body, now());
    else {
      if (!p) return fail(404, 'Unknown project.');
      if (body.expectedRevision !== p.revision) return fail(409, 'Reload the current project.', 'REVISION_CONFLICT');
      next = applyCommand(p, { type: body.type, input: body.input }, now());
    }
  } catch (error) { return fail(400, error.message, 'INVALID_INPUT'); }
  projects.set(next.id, next);
  const ack = { projectId: next.id, revision: next.revision, requestId: init.headers['idempotency-key'] };
  receipts.set(key, ack);
  if (dropAfterCommit) { dropAfterCommit = false; throw new Error('Simulated dropped response AFTER commit.'); }
  return json(ack);
}
async function dispatch(request) {
  const u = new URL(request.url);
  if (u.origin !== origin) return fail(400, 'Host rejected.');
  if (u.pathname === '/__test/control') {
    if (request.headers.get('x-test-control') !== controlKey || request.method !== 'POST') return fail(403, 'Test control only.');
    const input = await request.json();
    if (input.action === 'drop-next') dropAfterCommit = true;
    else if (input.action === 'revoke') revoked.add(input.orgId);
    else if (input.action === 'restore') revoked.delete(input.orgId);
    else if (input.action === 'read-only') input.value ? readOnly.add(input.orgId) : readOnly.delete(input.orgId);
    else if (input.action === 'expire') clockOffset += 7_200_000;
    else if (input.action !== 'inspect') return fail(400, 'Unknown fixture action.');
    return json({ organizations: Object.fromEntries([...organizations].map(([id, ps]) => [id, [...ps.values()]])), calls });
  }
  if (u.pathname.startsWith('/api/browser/')) return handle(request);
  if (request.method !== 'GET') return fail(405, 'GET only.');
  if (u.pathname === '/workspace' || u.pathname === '/') return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navyix synthetic connected tests</title><body><p role="note">SYNTHETIC INTEGRATION HARNESS — no customer data, live IdP or database</p><navyix-connected-workbench></navyix-connected-workbench><script type="module" src="/workbench/connected.mjs"></script></body></html>`, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
  const name = u.pathname.slice('/workbench/'.length), asset = u.pathname.startsWith('/workbench/') && assets.get(name);
  if (!asset) return fail(404, 'Not found.');
  let data;
  try { data = await readFile(new URL(asset, root)); }
  catch (error) {
    // Behavioral testing can run from an extracted increment; never claim visual validation in this mode.
    if (name !== 'workbench.css' || error.code !== 'ENOENT') throw error;
    data = '/* Base stylesheet absent. Behavioral test only; no visual assertions. */';
  }
  return new Response(data, { headers: { 'content-type': name.endsWith('.css') ? 'text/css' : 'text/javascript', 'cache-control': 'no-store' } });
}
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(origin).host) { res.writeHead(400); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    const body = Buffer.concat(chunks), request = new Request(origin + req.url, { method: req.method, headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) && body.length ? { body } : {}) });
    const response = await dispatch(request);
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
    if (response.headers.getSetCookie().length) res.setHeader('set-cookie', response.headers.getSetCookie());
    res.writeHead(response.status); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Fixture error"}}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const config = browserConfig({ ...env, NAVYIX_PUBLIC_ORIGIN: origin, NAVYIX_ALLOW_HTTP_LOOPBACK: 'true', NAVYIX_SESSION_KEY: randomBytes(32).toString('hex') });
handle = browserHandler({ config, store: new MemorySessions(), clock: now, fetcher: backend,
  oidc: { async exchange() { return { accessToken: token, expiresAt: now() + 1_800_000 }; } } });
let stylesLoaded = true; try { await readFile(new URL('apps/web/workbench/workbench.css', root)); } catch { stylesLoaded = false; }
console.log(JSON.stringify({ origin, controlKey, stylesLoaded, root: fileURLToPath(root) }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
