import 'server-only';
import { Pool } from 'pg';
import * as jose from 'jose';
import { browserConfig, browserHandler, oidcClient, PostgresSessions, createBrowserRuntime } from '@navyix/browser-session';

async function initialize(): Promise<(request: Request) => Promise<Response>> {
  const config = browserConfig(process.env);
  const connection = new URL(process.env.NAVYIX_SESSION_DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || decodeURIComponent(connection.username) !== 'navyix_browser') {
    throw new Error('Use the dedicated browser database login.');
  }
  if (process.env.NODE_ENV === 'production' && connection.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Verified database TLS is required in production.');
  }
  // Validate provider configuration before allocating the database pool.
  const oidc = oidcClient(config, jose);
  const pool = new Pool({ connectionString: connection.href, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 5000 });
  pool.on('error', () => console.error('NAVYIX_SESSION_POOL_ERROR'));
  const store = new PostgresSessions(pool);
  try {
    await store.assertSafe();
    return browserHandler({ config, store, oidc });
  } catch (error) {
    await pool.end();
    throw error;
  }
}
// Reuse one initialized handler. Only failed initialization is eligible for a bounded retry.
export const serveBrowser = createBrowserRuntime(initialize, {
  enabled: () => process.env.NAVYIX_BROWSER_ENABLED === 'true',
  // Only fixed event codes; never log connection strings, tokens or callback parameters.
  onError: code => console.error(code)
});
