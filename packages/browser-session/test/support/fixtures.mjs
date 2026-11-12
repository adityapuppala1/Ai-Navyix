import { browserConfig } from '../../src/config.mjs';
import { browserHandler } from '../../src/handler.mjs';
export const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const env = {
  NAVYIX_PUBLIC_ORIGIN: 'https://navyix.test', NAVYIX_API_ORIGIN: 'https://api.navyix.test', OIDC_ISSUER: 'https://identity.test',
  OIDC_JWKS_URL: 'https://identity.test/jwks', NAVYIX_OIDC_AUTHORIZATION_URL: 'https://identity.test/authorize',
  NAVYIX_OIDC_TOKEN_URL: 'https://identity.test/token', OIDC_CLIENT_ID: 'test-client', OIDC_AUDIENCE: 'navyix-api',
  OIDC_REQUIRED_SCOPE: 'navyix/workflow', NAVYIX_OIDC_CLIENT_AUTH: 'none', NAVYIX_SESSION_KEY: 'a1'.repeat(32)
};
/** Transactional semantics test double, NEVER an application session-storage fallback. */
export class MemorySessions {
  constructor() { this.logins = new Map(); this.sessions = new Map(); }
  async putLogin(key, sealed, expiresAt) { this.logins.set(key, { sealed, expiresAt }); }
  async consumeLogin(key) { const value = this.logins.get(key); this.logins.delete(key); return value; }
  async putSession(key, sealed, expiresAt, idleUntil) { this.sessions.set(key, { sealed, expiresAt, idleUntil }); }
  async getSession(key, now, idleSeconds) {
    const value = this.sessions.get(key); if (!value || value.expiresAt <= now || value.idleUntil <= now) return null;
    value.idleUntil = Math.min(value.expiresAt, now + idleSeconds * 1000); return value;
  }
  async deleteSession(key) { this.sessions.delete(key); }
}
export function fixture(options = {}) {
  const config = browserConfig({ ...env, ...options.env }); const store = new MemorySessions();
  let time = Date.parse('2026-11-11T10:00:00Z'); const calls = [], exchanges = [];
  const oidc = options.oidc || { async exchange(...args) { exchanges.push(args); return { accessToken: 'server-only-token', expiresAt: time + 1800000 }; } };
  const fetcher = options.fetcher || (async (url, init) => { calls.push({ url, init }); return Response.json({ allowed: true }); });
  const handle = browserHandler({ config, store, oidc, fetcher, clock: () => time });
  const req = (path, init = {}) => handle(new Request(config.origin + path, init));
  const post = (path, cookie = '', body = undefined, extra = {}) => req(path, { method: 'POST', headers: {
    origin: config.origin, 'sec-fetch-site': 'same-origin', cookie, 'content-type': 'application/json', ...extra },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  async function start() {
    const response = await post('/api/browser/login');
    return { response, location: new URL(response.headers.get('location')), loginCookie: response.headers.getSetCookie()[0].split(';')[0] };
  }
  async function login() {
    const started = await start(); const callback = `/api/browser/callback?state=${started.location.searchParams.get('state')}&code=test-code`;
    const response = await req(callback, { headers: { cookie: started.loginCookie } });
    const sessionCookie = response.headers.getSetCookie().find(c => c.startsWith(config.sessionCookie + '='))?.split(';')[0];
    const details = await req('/api/browser/session', { headers: { cookie: sessionCookie } });
    return { ...started, callback, response, sessionCookie, details: await details.json() };
  }
  return { handle, config, store, calls, exchanges, req, post, start, login, advance: ms => { time += ms; } };
}
