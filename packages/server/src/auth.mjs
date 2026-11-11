import { ApiError } from './errors.mjs';
const unauthorized = () => new ApiError(401, 'UNAUTHENTICATED', 'A valid API access token is required.');
function https(value, name) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash && !parsed.search) return value;
  } catch { /* configuration error below */ }
  throw new Error(`${name} must be an explicitly configured HTTPS URL without credentials, query or fragment.`);
}
export function authConfig(env) {
  const profile = env.OIDC_TOKEN_PROFILE || 'jwt-access';
  if (!['jwt-access', 'cognito-access'].includes(profile)) throw new Error('Unsupported OIDC_TOKEN_PROFILE.');
  const issuer = https(env.OIDC_ISSUER, 'OIDC_ISSUER');
  const jwksUrl = https(env.OIDC_JWKS_URL, 'OIDC_JWKS_URL');
  const audience = env.OIDC_AUDIENCE;
  const clientId = env.OIDC_CLIENT_ID;
  const requiredScope = env.OIDC_REQUIRED_SCOPE;
  if (profile === 'jwt-access' && (!audience || typeof audience !== 'string')) throw new Error('OIDC_AUDIENCE is required.');
  if (profile === 'cognito-access' && (!clientId || typeof clientId !== 'string')) throw new Error('OIDC_CLIENT_ID is required.');
  if (typeof requiredScope !== 'string' || !requiredScope || /\s/.test(requiredScope)) throw new Error('A single OIDC_REQUIRED_SCOPE is required.');
  return Object.freeze({ profile, issuer, jwksUrl, audience, clientId, requiredScope });
}
export function bearer(header) {
  if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) throw unauthorized();
  return header.slice(7);
}
/** Called only AFTER jose verifies the signature and registered claims. */
export function principalFromVerified({ payload, protectedHeader }, config, now = Date.now()) {
  const time = Math.floor(now / 1000);
  if (!payload || !protectedHeader || !['RS256', 'ES256'].includes(protectedHeader.alg) || payload.iss !== config.issuer ||
      typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= time || !Number.isSafeInteger(payload.iat) || payload.iat > time + 30 ||
      payload.iat < time - 3600 || payload.exp <= payload.iat || payload.exp - payload.iat > 3600 ||
      (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf > time + 30))) throw unauthorized();
  if (config.profile === 'cognito-access') {
    if (protectedHeader.alg !== 'RS256' || payload.token_use !== 'access' || payload.client_id !== config.clientId) throw unauthorized();
  } else {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.audience) || !['at+jwt', 'application/at+jwt'].includes(protectedHeader.typ)) throw unauthorized();
  }
  if (typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(config.requiredScope)) throw unauthorized();
  // Never trust email, organization, project or role claims for membership authorization.
  return Object.freeze({ issuer: payload.iss, subject: payload.sub });
}
/** jose is injected for testing only; application bootstrap supplies the installed library. */
export function createAuthenticator(config, jose) {
  const keys = jose.createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 });
  const options = {
    issuer: config.issuer, algorithms: config.profile === 'cognito-access' ? ['RS256'] : ['RS256', 'ES256'],
    requiredClaims: ['iss', 'sub', 'iat', 'exp'], maxTokenAge: 3600, clockTolerance: 0,
    ...(config.profile === 'jwt-access' ? { audience: config.audience, typ: 'at+jwt' } : {})
  };
  return async header => {
    const token = bearer(header);
    try { return principalFromVerified(await jose.jwtVerify(token, keys, options), config); }
    catch { throw unauthorized(); } // No token, claims, key URLs or provider errors in responses/logs.
  };
}
