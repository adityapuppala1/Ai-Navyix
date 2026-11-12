import { createHash, createHmac } from 'node:crypto';
import { ApiError, object, uuid } from './errors.mjs';
import { invitationEmail } from './invitation-identity.mjs';
const ROLES = ['CONTRIBUTOR', 'REVIEWER', 'VIEWER'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => hash(JSON.stringify(value));
const input = message => new ApiError(400, 'INVALID_INPUT', message);
export function invitationPrincipal(principal) {
  if (!principal || typeof principal.issuer !== 'string' || !principal.issuer || principal.issuer.length > 2048 ||
      typeof principal.subject !== 'string' || !principal.subject || principal.subject.length > 255) throw new ApiError(401, 'UNAUTHENTICATED', 'A verified account is required.');
  return { issuer: principal.issuer, subject: principal.subject };
}
export function invitationCode(value) {
  if (typeof value !== 'string' || !/^nvi1\.[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value.slice(5), 'base64url').toString('base64url') !== value.slice(5)) throw input('Use the complete invitation code.');
  return value;
}
/** Repository commits invitation/membership/audit/receipt atomically. No email delivery or project grants. */
export class InvitationService {
  constructor(repository, { key, identity }) {
    if (!Buffer.isBuffer(key) || key.length !== 32 || !identity?.verify) throw new Error('Invitation configuration is required.');
    this.repository = repository; this.key = Buffer.from(key); this.identity = identity;
  }
  async list(principal, orgId, options = {}) {
    const actor = invitationPrincipal(principal); orgId = uuid(orgId); object(options, ['after', 'limit']);
    const limit = options.limit ?? 20, after = options.after === undefined ? null : uuid(options.after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw input('Limit must be 1–20.');
    return this.repository.execute(actor, 'list', orgId, { limit, after }, null);
  }
  async create(principal, orgId, value, requestId) {
    const actor = invitationPrincipal(principal); orgId = uuid(orgId); requestId = uuid(requestId);
    object(value, ['email', 'role', 'hours']);
    const email = invitationEmail(value.email), role = value.role, hours = value.hours ?? 24;
    if (!ROLES.includes(role) || !Number.isSafeInteger(hours) || hours < 1 || hours > 72) throw input('Choose a contributor, reviewer or viewer role and 1–72 hour expiry.');
    const requestHash = fingerprint({ operation: 'create', orgId, email, role, hours });
    // A retry can recover the same code without storing a plaintext secret or minting another invite.
    const code = 'nvi1.' + createHmac('sha256', this.key).update(JSON.stringify(['navyix-invite/1', actor.issuer, actor.subject, orgId, requestId, requestHash])).digest('base64url');
    const tokenHash = hash(code);
    const result = await this.repository.execute(actor, 'create', orgId, { email, role, hours, requestHash, tokenHash }, requestId);
    if (result.tokenHash !== tokenHash) throw new ApiError(409, 'INVITATION_REISSUE_REQUIRED', 'The invitation key changed. Revoke the old invitation and create a new one.');
    const { tokenHash: _private, ...safe } = result;
    return { ...safe, code };
  }
  async revoke(principal, orgId, invitationId, requestId) {
    const actor = invitationPrincipal(principal); orgId = uuid(orgId); invitationId = uuid(invitationId); requestId = uuid(requestId);
    const requestHash = fingerprint({ operation: 'revoke', orgId, invitationId });
    return this.repository.execute(actor, 'revoke', orgId, { invitationId, requestHash }, requestId);
  }
  async recipient(principal, authorization, value, requestId, operation) {
    const actor = invitationPrincipal(principal); object(value, ['code']); const code = invitationCode(value.code);
    requestId = uuid(requestId);
    // Do not use a body email, a token's unverified email claim, or an existing User.email as proof.
    const recipient = await this.identity.verify(actor, authorization);
    if (recipient.issuer !== actor.issuer || recipient.subject !== actor.subject) throw new ApiError(403, 'RECIPIENT_UNVERIFIED', 'Recipient identity does not match the signed-in account.');
    const email = invitationEmail(recipient.email), tokenHash = hash(code);
    const requestHash = fingerprint({ operation, tokenHash });
    return this.repository.execute({ ...actor, email }, operation, null, { tokenHash, requestHash }, requestId);
  }
  preview(principal, authorization, value, requestId) { return this.recipient(principal, authorization, value, requestId, 'preview'); }
  accept(principal, authorization, value, requestId) { return this.recipient(principal, authorization, value, requestId, 'accept'); }
}
