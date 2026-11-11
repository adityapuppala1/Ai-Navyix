// Cross-platform CLI entry: use the same optional root .env as Nest, without a shell.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
try { process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('prisma'), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.once('error', () => { console.error('Prisma CLI could not start. Install the declared dependencies first.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
