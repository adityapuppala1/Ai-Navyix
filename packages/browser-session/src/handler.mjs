import { BrowserError, reject } from './config.mjs';
import { randomToken, hash, challenge, equal, seal, unseal } from './crypto.mjs';
import { limitedText } from './oidc.mjs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const id = new RegExp(`^${UUID}$`, 'i');
const token = value => typeof value === 'string' && /^[\w-]{43}$/.test(value);
const headers = () => new Headers({ 'cache-control': 'no-store', pragma: 'no-cache', 'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', vary: 'Cookie' });
const json = (value, status = 200, cookies = []) => {
  const h = headers(); cookies.forEach(c => h.append('set-cookie', c)); return new Response(JSON.stringify(value), { status, headers: h });
};
function cookie(req, name) {
  const values = (req.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`)).map(s => s.slice(name.length + 1));
  if (values.length > 1) reject(401, 'SESSION_INVALID', 'Sign in again.');
  return token(values[0]) ? values[0] : null;
}
function setCookie(config, name, value, seconds) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.secure ? '; Secure' : ''}`;
}
function sameOrigin(req, config) {
  if (req.headers.get('origin') !== config.origin || (req.headers.has('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin'))
    reject(403, 'ORIGIN_DENIED', 'This action requires a same-origin request.');
}
function redirect(location, cookies) {
  const h = headers(); h.set('location', location); cookies.forEach(c => h.append('set-cookie', c));
  return new Response(null, { status: 303, headers: h });
}
function proxyTarget(url, method) {
  const route = new RegExp(`^/api/browser/api/orgs/(${UUID})/projects(?:/(${UUID})(?:/(commands|readiness|report-template|github-evidence|team|team/commands|assessments/ASM-\\d{3}))?)?$`, 'i').exec(url.pathname);
  if (!route) reject(404, 'NOT_FOUND', 'Unknown browser API route.');
  const [, , projectId, operation] = route;
  const allowed = operation === 'commands' || operation === 'team/commands' || (!projectId && method === 'POST') ? 'POST' : 'GET';
  if (method !== allowed) reject(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this route.');
  const keys = [...url.searchParams.keys()];
  const valid = (!projectId && method === 'GET') || operation === 'team' ? ['after', 'limit'] : operation === 'readiness' ? ['stage', 'buildId', 'environment'] : operation === 'report-template' ? ['buildId'] : operation === 'github-evidence' ? ['buildId', 'runId', 'attempt'] : [];
  if (new Set(keys).size !== keys.length || keys.some(k => !valid.includes(k))) reject(400, 'INVALID_QUERY', 'Unexpected or repeated query parameter.');
  for (const [k, v] of url.searchParams) {
    if ((k === 'after' && !id.test(v)) || (k === 'limit' && (!/^\d{1,2}$/.test(v) || +v < 1 || +v > 50)) ||
      (k === 'stage' && !['design', 'build', 'test', 'release'].includes(v)) || (k === 'buildId' && !/^BLD-\d{3}$/.test(v)) ||
      (['runId', 'attempt'].includes(k) && (!/^[1-9]\d{0,15}$/.test(v) || !Number.isSafeInteger(Number(v)) || (k === 'attempt' && Number(v) > 1000))) ||
      (k === 'environment' && (!v.trim() || v.length > 80))) reject(400, 'INVALID_QUERY', 'Invalid query parameter.');
  }
  return '/v1/' + url.pathname.slice('/api/browser/api/'.length) + url.search;
}

/** Fetch API handler shared with the Next route. Store and OIDC implementation are server dependencies. */
export function browserHandler({ config, store, oidc, fetcher = fetch, clock = Date.now }) {
  const context = (type, recordId) => `${config.origin}|${type}|${recordId}`;
  const expiredCookie = name => setCookie(config, name, '', 0);
  async function session(req) {
    const raw = cookie(req, config.sessionCookie);
    if (!raw) reject(401, 'SIGN_IN_REQUIRED', 'Sign in to open your workspace.');
    const key = hash(raw), record = await store.getSession(key, clock(), config.idleSeconds);
    if (!record || record.expiresAt <= clock()) reject(401, 'SESSION_EXPIRED', 'Your session expired. Sign in again.');
    try { return { key, data: unseal(record.sealed, config.key, context('session', key)), expiresAt: record.expiresAt }; }
    catch { await store.deleteSession(key); reject(401, 'SESSION_INVALID', 'Sign in again.'); }
  }
  return async req => {
    const url = new URL(req.url), path = url.pathname;
    try {
      if (url.origin !== config.origin) reject(400, 'HOST_DENIED', 'Request origin is not configured.');
      if (req.headers.has('authorization')) reject(400, 'COOKIE_SESSION_REQUIRED', 'Use the browser session, not a supplied token.');
      if (!['GET', 'POST'].includes(req.method)) reject(405, 'METHOD_NOT_ALLOWED', 'Only GET and POST are supported.');
      if (path === '/api/browser/login') {
        if (req.method !== 'POST' || url.search) reject(405, 'METHOD_NOT_ALLOWED', 'Sign in with a same-origin POST.');
        sameOrigin(req, config);
        const state = randomToken(), binding = randomToken(), verifier = randomToken(), nonce = randomToken();
        const key = hash(state);
        const transaction = { binding: hash(binding), verifier, nonce };
        await store.putLogin(key, seal(transaction, config.key, context('login', key)), clock() + config.loginSeconds * 1000);
        const to = new URL(config.authorizationUrl);
        to.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.callbackUrl,
          scope: `openid ${config.scope}`, state, nonce, code_challenge: challenge(verifier), code_challenge_method: 'S256' }).toString();
        return redirect(to.href, [setCookie(config, config.loginCookie, binding, config.loginSeconds)]);
      }
      if (path === '/api/browser/callback') {
        if (req.method !== 'GET') reject(405, 'METHOD_NOT_ALLOWED', 'Callback requires GET.');
        const keys = [...url.searchParams.keys()];
        if (keys.length > 6 || new Set(keys).size !== keys.length || keys.some(k => !['code', 'state', 'iss', 'error', 'error_description', 'error_uri', 'session_state'].includes(k)))
          reject(400, 'INVALID_CALLBACK', 'Invalid sign-in response.');
        const state = url.searchParams.get('state'), binding = cookie(req, config.loginCookie);
        if (!token(state) || !binding) reject(401, 'LOGIN_FAILED', 'Restart sign-in.');
        const key = hash(state), record = await store.consumeLogin(key);
        if (!record || record.expiresAt <= clock()) reject(401, 'LOGIN_FAILED', 'Sign-in expired or was already used.');
        const saved = unseal(record.sealed, config.key, context('login', key));
        if (!equal(saved.binding, hash(binding)) || (url.searchParams.has('iss') && url.searchParams.get('iss') !== config.issuer))
          reject(401, 'LOGIN_FAILED', 'Sign-in response does not match this browser.');
        const code = url.searchParams.get('code');
        if (url.searchParams.has('error') || !code || code.length > 4096 || /[\r\n\0]/.test(code)) reject(401, 'LOGIN_FAILED', 'Sign-in was not completed.');
        const verified = await oidc.exchange(code, saved.verifier, saved.nonce);
        if (!Number.isFinite(verified.expiresAt) || verified.expiresAt <= clock()) reject(401, 'LOGIN_FAILED', 'Sign-in expired.');
        const raw = randomToken(), sessionKey = hash(raw), csrf = randomToken();
        const expiresAt = Math.min(verified.expiresAt, clock() + config.sessionSeconds * 1000);
        await store.putSession(sessionKey, seal({ accessToken: verified.accessToken, csrf }, config.key, context('session', sessionKey)),
          expiresAt, Math.min(expiresAt, clock() + config.idleSeconds * 1000));
        const old = cookie(req, config.sessionCookie); if (old) await store.deleteSession(hash(old));
        return redirect(`${config.origin}/workspace`, [expiredCookie(config.loginCookie),
          setCookie(config, config.sessionCookie, raw, Math.max(1, Math.floor((expiresAt - clock()) / 1000)))]);
      }
      if (path === '/api/browser/session' && req.method === 'GET' && !url.search) {
        const s = await session(req);
        return json({ authenticated: true, csrfToken: s.data.csrf, expiresAt: new Date(s.expiresAt).toISOString() });
      }
      if (path === '/api/browser/logout' && req.method === 'POST' && !url.search) {
        sameOrigin(req, config); const s = await session(req);
        if (!equal(req.headers.get('x-navyix-csrf'), s.data.csrf)) reject(403, 'CSRF_DENIED', 'Reload the workspace and retry.');
        await store.deleteSession(s.key);
        return json({ signedOut: true }, 200, [expiredCookie(config.sessionCookie), expiredCookie(config.loginCookie)]);
      }
      const target = proxyTarget(url, req.method);
      const s = await session(req);
      const outgoing = { accept: 'application/json', authorization: `Bearer ${s.data.accessToken}` };
      let body;
      if (req.method === 'POST') {
        sameOrigin(req, config);
        if (!equal(req.headers.get('x-navyix-csrf'), s.data.csrf)) reject(403, 'CSRF_DENIED', 'Reload the workspace and retry.');
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('content-type') || '') || req.headers.has('content-encoding'))
          reject(415, 'UNSUPPORTED_MEDIA', 'Send uncompressed JSON.');
        const requestId = req.headers.get('idempotency-key');
        if (!id.test(requestId || '')) reject(400, 'IDEMPOTENCY_REQUIRED', 'A valid request ID is required.');
        try { body = await limitedText(req, 1_000_000); JSON.parse(body); }
        catch (error) { reject(error.message === 'Response too large.' ? 413 : 400, 'INVALID_BODY', 'Request must contain JSON no larger than 1 MB.'); }
        outgoing['content-type'] = 'application/json'; outgoing['idempotency-key'] = requestId;
      }
      let response, value;
      try {
        response = await fetcher(config.apiOrigin + target, { method: req.method, headers: outgoing, body,
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Expected JSON.');
        value = JSON.parse(await limitedText(response, 4_000_000));
      } catch { reject(502, 'BACKEND_UNAVAILABLE', 'The server could not confirm this operation. Retry the same request, not a new submission.'); }
      if (response.status === 401) {
        await store.deleteSession(s.key);
        return json({ error: { code: 'SESSION_EXPIRED', message: 'Sign in again.' } }, 401, [expiredCookie(config.sessionCookie)]);
      }
      const evidenceRead = req.method === 'GET' && /\/github-evidence(?:\?|$)/.test(target);
      if (![200, 201, 400, 403, 404, 409, 413, 415, ...(evidenceRead ? [429, 502, 503] : [])].includes(response.status)) reject(502, 'BACKEND_UNAVAILABLE', 'The server could not confirm this operation. Retry the same request.');
      return json(value, response.status); // Upstream cookies, redirects and caching headers are never forwarded.
    } catch (error) {
      if (path === '/api/browser/callback') return redirect(`${config.origin}/workspace?login=failed`, [expiredCookie(config.loginCookie)]);
      const known = error instanceof BrowserError;
      return json({ error: { code: known ? error.code : 'SESSION_SERVICE_UNAVAILABLE', message: known ? error.message : 'Session service is unavailable. Try again later.' } },
        known ? error.status : 503, known && error.status === 401 ? [expiredCookie(config.sessionCookie)] : []);
    }
  };
}
