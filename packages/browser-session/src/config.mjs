/** Server-only configuration. No trust is placed in forwarded host headers. */
export class BrowserError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const reject = (status, code, message) => { throw new BrowserError(status, code, message); };
export function browserConfig(env) {
  const dev = env.NODE_ENV !== 'production' && env.NAVYIX_ALLOW_HTTP_LOOPBACK === 'true';
  const url = (value, name, originOnly = false, allowLoopback = false) => {
    let u;
    try { u = new URL(value); } catch { throw new Error(`${name} is required and must be a URL.`); }
    const local = dev && allowLoopback && u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if ((!local && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || (originOnly && u.pathname !== '/'))
      throw new Error(`${name} must be a fixed HTTPS ${originOnly ? 'origin' : 'URL'} without query, credentials or fragment.`);
    return originOnly ? u.origin : u.href;
  };
  const origin = url(env.NAVYIX_PUBLIC_ORIGIN, 'NAVYIX_PUBLIC_ORIGIN', true, true);
  const apiOrigin = url(env.NAVYIX_API_ORIGIN, 'NAVYIX_API_ORIGIN', true, true);
  if (apiOrigin === origin) throw new Error('NAVYIX_API_ORIGIN must address the backend, not the browser origin.');
  url(env.OIDC_ISSUER, 'OIDC_ISSUER');
  const jwksUrl = url(env.OIDC_JWKS_URL, 'OIDC_JWKS_URL');
  const authorizationUrl = url(env.NAVYIX_OIDC_AUTHORIZATION_URL, 'NAVYIX_OIDC_AUTHORIZATION_URL');
  const tokenUrl = url(env.NAVYIX_OIDC_TOKEN_URL, 'NAVYIX_OIDC_TOKEN_URL');
  const clientId = env.OIDC_CLIENT_ID;
  const scope = env.OIDC_REQUIRED_SCOPE;
  if (typeof clientId !== 'string' || !clientId || clientId.length > 255 || /[\r\n]/.test(clientId)) throw new Error('OIDC_CLIENT_ID is required.');
  if (typeof scope !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]{1,255}$/.test(scope) || scope === 'openid') throw new Error('A single API OIDC_REQUIRED_SCOPE is required.');
  const profile = env.OIDC_TOKEN_PROFILE || 'jwt-access';
  if (!['jwt-access', 'cognito-access'].includes(profile) || (profile === 'jwt-access' && !env.OIDC_AUDIENCE)) throw new Error('Configure the API token profile and audience.');
  const clientAuth = env.NAVYIX_OIDC_CLIENT_AUTH || 'client_secret_basic';
  if (!['none', 'client_secret_basic'].includes(clientAuth)) throw new Error('Unsupported client authentication method.');
  const clientSecret = env.NAVYIX_OIDC_CLIENT_SECRET;
  if (clientAuth === 'client_secret_basic' && (typeof clientSecret !== 'string' || !clientSecret || clientSecret.length > 4096)) throw new Error('Configure a confidential-client secret.');
  if (!/^[a-f0-9]{64}$/i.test(env.NAVYIX_SESSION_KEY || '')) throw new Error('NAVYIX_SESSION_KEY must be a random 32-byte hex key.');
  const secure = origin.startsWith('https:');
  return Object.freeze({ origin, apiOrigin, issuer: env.OIDC_ISSUER, jwksUrl, authorizationUrl, tokenUrl, clientId, clientSecret,
    clientAuth, scope, profile, audience: env.OIDC_AUDIENCE, key: Buffer.from(env.NAVYIX_SESSION_KEY, 'hex'), secure,
    sessionCookie: secure ? '__Host-navyix-session' : 'navyix-dev-session',
    loginCookie: secure ? '__Host-navyix-login' : 'navyix-dev-login',
    callbackUrl: `${origin}/api/browser/callback`, sessionSeconds: 3600, idleSeconds: 900, loginSeconds: 600 });
}
