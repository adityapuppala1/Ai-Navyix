import 'server-only';
import { Pool } from 'pg';
import * as jose from 'jose';
import { browserConfig, browserHandler, oidcClient, PostgresSessions } from '@navyix/browser-session';

let initialization: Promise<(request: Request) => Promise<Response>> | undefined;
async function initialize(): Promise<(request: Request) => Promise<Response>> {
  const config = browserConfig(process.env);
  const connection = new URL(process.env.NAVYIX_SESSION_DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || decodeURIComponent(connection.username) !== 'navyix_browser') {
    throw new Error('Use the dedicated browser database login.');
  }
  if (process.env.NODE_ENV === 'production' && connection.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Verified database TLS is required in production.');
  }
  const pool = new Pool({ connectionString: connection.href, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 5000 });
  pool.on('error', () => console.error('NAVYIX_SESSION_POOL_ERROR'));
  const store = new PostgresSessions(pool);
  try { await store.assertSafe(); }
  catch (error) { await pool.end(); throw error; }
  return browserHandler({ config, store, oidc: oidcClient(config, jose) });
}
export async function serveBrowser(request: Request): Promise<Response> {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (process.env.NAVYIX_BROWSER_ENABLED !== 'true') {
    return new Response(JSON.stringify({ error: { code: 'BROWSER_DISABLED', message: 'Server sign-in is not enabled.' } }), { status: 503, headers });
  }
  try {
    initialization ??= initialize();
    return await (await initialization)(request);
  } catch {
    initialization = undefined;
    // Never log connection strings, token responses or callback parameters.
    console.error('NAVYIX_BROWSER_STARTUP_FAILED');
    return new Response(JSON.stringify({ error: { code: 'BROWSER_UNAVAILABLE', message: 'Server sign-in is not configured or is unavailable.' } }), { status: 503, headers });
  }
}
