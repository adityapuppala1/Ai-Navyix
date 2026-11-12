import { ApiError } from './errors.mjs';

// Conservative pilot address policy: ASCII dot-atom, exact local-part, case-folded domain.
// Do not remove dots, plus-tags or change local-part case to merge different addresses.
export function invitationEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || value !== value.trim()) throw new ApiError(400, 'INVALID_EMAIL', 'Use a valid ASCII email address.');
  const parts = value.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(parts[0]) ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(parts[1])) {
    throw new ApiError(400, 'INVALID_EMAIL', 'Use a valid ASCII email address.');
  }
  return parts[0] + '@' + parts[1].toLowerCase();
}
export function invitationConfig(env) {
  if (!env.NAVYIX_INVITATIONS_ENABLED || env.NAVYIX_INVITATIONS_ENABLED === 'false') return null;
  if (env.NAVYIX_INVITATIONS_ENABLED !== 'true' || env.NAVYIX_API_ENABLED !== 'true') throw new Error('Invitations require the authenticated API.');
  const fixed = (value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href;
  };
  try {
    fixed(env.OIDC_ISSUER);
    const userinfoUrl = fixed(env.NAVYIX_INVITATION_USERINFO_URL);
    if (!/^[a-f0-9]{64}$/i.test(env.NAVYIX_INVITATION_KEY || '') || env.NAVYIX_INVITATION_KEY === env.NAVYIX_SESSION_KEY) throw new Error();
    return Object.freeze({ issuer: env.OIDC_ISSUER, userinfoUrl, key: Buffer.from(env.NAVYIX_INVITATION_KEY, 'hex') });
  } catch { throw new Error('Configure the approved HTTPS UserInfo endpoint and a distinct random 32-byte invitation key.'); }
}
const unavailable = () => new ApiError(503, 'IDENTITY_UNAVAILABLE', 'Recipient identity could not be verified. Retry later.');
const unverified = () => new ApiError(403, 'RECIPIENT_UNVERIFIED', 'Sign in with the invited account and verify its email with your identity provider.');

/** Fixed operator-approved OIDC UserInfo URL; no caller-provided URL or identity claim. */
export class InvitationIdentity {
  constructor(config, { fetcher = fetch, clock = Date.now } = {}) {
    this.config = config; this.fetcher = fetcher; this.clock = clock; this.active = 0; this.recent = new Map();
  }
  async verify(principal, authorization) {
    if (!principal || principal.issuer !== this.config.issuer || typeof principal.subject !== 'string' || !principal.subject ||
        typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/i.test(authorization)) throw unverified();
    const now = this.clock(), key = principal.issuer + '\n' + principal.subject;
    for (const [k, until] of this.recent) if (until <= now) this.recent.delete(k);
    if (this.active >= 4 || this.recent.has(key) || this.recent.size >= 2048) throw new ApiError(429, 'INVITATION_BACKOFF', 'Wait briefly before verifying another invitation.');
    this.recent.set(key, now + 1000); this.active++;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    let reader;
    try {
      const response = await this.fetcher(this.config.userinfoUrl, { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { accept: 'application/json', authorization } });
      if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
        void response.body?.cancel().catch(() => {}); throw unavailable();
      }
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > 32768)) { void response.body.cancel().catch(() => {}); throw unavailable(); }
      reader = response.body.getReader(); let bytes = 0, chunks = 0; const data = [];
      const interrupted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true }));
      // A reader that ignores cancellation must still be bounded by the deadline.
      for (;;) {
        controller.signal.throwIfAborted();
        const part = await Promise.race([reader.read(), interrupted]);
        if (part.done) break;
        if (++chunks > 1024 || (bytes += part.value.byteLength) > 32768) throw unavailable();
        data.push(part.value);
      }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(data)));
      if (!value || value.sub !== principal.subject || value.email_verified !== true) throw unverified();
      let email;
      try { email = invitationEmail(value.email); } catch { throw unverified(); }
      return Object.freeze({ issuer: principal.issuer, subject: principal.subject, email });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer); this.active--;
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
}
