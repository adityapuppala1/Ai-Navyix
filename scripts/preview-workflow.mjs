/** Loopback-only static preview. No API, credentials, external downloads or shell execution. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
const assets = new Map([
  ['/', ['apps/web/workbench/index.html', 'text/html']],
  ['/workspace', ['apps/web/workbench/index.html', 'text/html']],
  ['/app.mjs', ['apps/web/workbench/app.mjs', 'text/javascript']],
  ['/workbench.css', ['apps/web/workbench/workbench.css', 'text/css']],
  ['/workflow.mjs', ['packages/workflow/src/workflow.mjs', 'text/javascript']],
  ['/storage.mjs', ['packages/workflow/src/storage.mjs', 'text/javascript']]
]);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403); res.end('Invalid host'); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Read-only preview'); return; }
  const route = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  const asset = assets.get(route);
  if (!asset) { res.writeHead(404); res.end('Not found'); return; }
  try { const bytes = await readFile(path.join(root, asset[0])); res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(req.method === 'HEAD' ? undefined : bytes); }
  catch { res.writeHead(500); res.end('Preview asset unavailable'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Navyix local workflow: http://127.0.0.1:${port} (Ctrl+C to stop)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
