import { createHash } from 'node:crypto';
import { principalFromVerified } from '../../server/src/auth.mjs';
import { BrowserError } from './config.mjs';
import { equal } from './crypto.mjs';

export async function limitedText(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Response too large.');
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks = []; let bytes = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength;
    if (bytes > maxBytes) throw new Error('Response too large.'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
/** jwtVerify is supplied by the installed JOSE library in the application, never by browser input. */
export function oidcClient(config, jose, fetcher = fetch, clock = Date.now) {
  const keys = jose.createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 });
  return {
    async exchange(code, verifier, nonce) {
      try {
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.callbackUrl,
          client_id: config.clientId, code_verifier: verifier });
        const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
        if (config.clientAuth === 'client_secret_basic') {
          const enc = x => new URLSearchParams({ x }).toString().slice(2);
          headers.authorization = `Basic ${Buffer.from(`${enc(config.clientId)}:${enc(config.clientSecret)}`).toString('base64')}`;
        }
        const response = await fetcher(config.tokenUrl, { method: 'POST', headers, body: body.toString(), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Token exchange failed.');
        const tokens = JSON.parse(await limitedText(response, 65536));
        const jwt = t => typeof t === 'string' && t.length <= 8192 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t);
        if (!jwt(tokens.id_token) || !jwt(tokens.access_token) || String(tokens.token_type).toLowerCase() !== 'bearer') throw new Error('Invalid token response.');
        const now = Math.floor(clock() / 1000);
        const id = await jose.jwtVerify(tokens.id_token, keys, { issuer: config.issuer, audience: config.clientId,
          algorithms: ['RS256', 'ES256'], requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp', 'nonce'], clockTolerance: 0, currentDate: new Date(clock()) });
        const p = id.payload;
        const audiences = Array.isArray(p.aud) ? p.aud : [p.aud];
        if (p.iss !== config.issuer || typeof p.sub !== 'string' || !p.sub || p.sub.length > 255 || !audiences.includes(config.clientId) ||
          !equal(p.nonce, nonce) || !Number.isSafeInteger(p.exp) || p.exp <= now || !Number.isSafeInteger(p.iat) || p.iat > now + 30 || p.iat < now - 3600 ||
          (p.azp !== undefined && p.azp !== config.clientId) || (audiences.length > 1 && p.azp !== config.clientId) ||
          (p.token_use !== undefined && p.token_use !== 'id')) throw new Error('Invalid identity token.');
        if (p.at_hash !== undefined) {
          const digest = createHash('sha256').update(tokens.access_token).digest().subarray(0, 16).toString('base64url');
          if (!equal(p.at_hash, digest)) throw new Error('Access-token binding failed.');
        }
        const access = await jose.jwtVerify(tokens.access_token, keys, { issuer: config.issuer,
          algorithms: config.profile === 'cognito-access' ? ['RS256'] : ['RS256', 'ES256'],
          requiredClaims: ['iss', 'sub', 'iat', 'exp'], maxTokenAge: 3600, clockTolerance: 0, currentDate: new Date(clock()),
          ...(config.profile === 'jwt-access' ? { audience: config.audience, typ: 'at+jwt' } : {}) });
        const principal = principalFromVerified(access, { ...config, requiredScope: config.scope }, clock());
        if (principal.subject !== p.sub || principal.issuer !== p.iss) throw new Error('Token subjects differ.');
        const expiresAt = Math.min(p.exp, access.payload.exp, now + config.sessionSeconds) * 1000;
        if (expiresAt < clock() + 10000) throw new Error('Token expires too soon.');
        return { accessToken: tokens.access_token, issuer: p.iss, subject: p.sub, expiresAt };
      } catch { throw new BrowserError(401, 'LOGIN_FAILED', 'Sign-in could not be verified. Start sign-in again.'); }
    }
  };
}
