/** Default: read-only preflight. --run: explicit disposable-local-DB mutations only. */
import { mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, options } from './lib/integration-lab.mjs';

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  const settings = options(process.argv.slice(2));
  if (settings.report) {
    try { lstatSync(resolve(settings.report)); throw new Error('Report path already exists. Choose a new file; existing files are never overwritten.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const report = await execute(fileURLToPath(new URL('../', import.meta.url)), settings, {
    signal: controller.signal, progress: name => console.error(`[Navyix acceptance] ${name}`)
  });
  if (settings.report) {
    const path = resolve(settings.report); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'blocked' ? 2 : report.status === 'interrupted' ? 130 : report.status === 'failed' ? 1 : 0;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
