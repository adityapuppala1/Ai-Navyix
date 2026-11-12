/** Cookie-session transport; invitation codes live in memory only, never URLs/storage. */
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ROLES = ['CONTRIBUTOR','REVIEWER','VIEWER'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = () => fail('INVALID_INVITATION_RESPONSE', 'The invitation response could not be confirmed.');
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export class InvitationClient {
  constructor(workspace) { this.api = workspace; this.epoch = 0; this.reset(); }
  reset() { this.epoch++; this.orgId = null; this.rows = []; this.next = null; this.preview = null; this.pending = null; this.adminGeneration = null; this.previewGeneration = null; this.flight = null; }
  current(epoch, generation) {
    if (epoch !== this.epoch || generation !== this.api.generation || !this.api.authenticated) fail('STALE_CONTEXT', 'Session or organization changed.');
  }
  requireSession(generation = this.api.generation) {
    if (!this.api.authenticated || generation !== this.api.generation) {
      this.reset();
      fail('STALE_CONTEXT', 'Sign in and reload this invitation context before continuing.');
    }
  }
  async list(orgId, after = null) {
    this.requireSession();
    if (this.pending) fail('PENDING_INVITATION', 'Resolve the unconfirmed request first.');
    if (!ID.test(orgId || '') || (after && !ID.test(after))) fail('INVALID_INPUT', 'Choose an organization.');
    const epoch = ++this.epoch, generation = this.api.generation;
    if (this.orgId !== orgId) { this.preview = null; this.previewGeneration = null; }
    this.orgId = orgId; this.rows = []; this.next = null; this.adminGeneration = null;
    const result = await this.api.request(`api/orgs/${orgId}/invitations?limit=20${after ? '&after=' + after : ''}`);
    this.current(epoch, generation);
    if (result?.orgId !== orgId || !Array.isArray(result.invitations) || result.invitations.length > 20) invalid();
    let previous = after;
    const rows = result.invitations.map(row => {
      if (!ID.test(row?.id || '') || (previous && row.id <= previous) || typeof row.email !== 'string' || row.email.length > 254 ||
          !ROLES.includes(row.role) || !['pending','accepted','revoked','expired'].includes(row.status) || !date(row.createdAt) || !date(row.expiresAt)) invalid();
      previous = row.id;
      return { id: row.id, email: row.email, role: row.role, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt };
    });
    if (result.next !== null && (!ID.test(result.next || '') || rows.length !== 20 || result.next !== rows.at(-1).id)) invalid();
    this.rows = rows; this.next = result.next; this.adminGeneration = generation; return rows;
  }
  async inspect(code) {
    this.requireSession();
    if (this.pending) fail('PENDING_INVITATION', 'Resolve the unconfirmed request first.');
    if (!/^nvi1\.[A-Za-z0-9_-]{43}$/.test(code || '')) fail('INVALID_INPUT', 'Paste the complete invitation code.');
    const epoch = ++this.epoch, generation = this.api.generation; this.preview = null; this.previewGeneration = null;
    const result = await this.api.request('api/me/invitations/preview', { method: 'POST', body: { code }, key: this.api.uuid() });
    this.current(epoch, generation);
    if (!ID.test(result?.orgId || '') || typeof result.organizationName !== 'string' || !result.organizationName || result.organizationName.length > 200 ||
        !ROLES.includes(result.role) || !date(result.expiresAt) || typeof result.alreadyMember !== 'boolean') invalid();
    this.preview = { orgId: result.orgId, organizationName: result.organizationName, role: result.role, expiresAt: result.expiresAt, alreadyMember: result.alreadyMember, code };
    this.previewGeneration = generation;
    return this.preview;
  }
  async start(kind, path, body, expected) {
    if (!this.api.authenticated) fail('SIGN_IN_REQUIRED', 'Sign in first.');
    if (this.pending) fail('PENDING_INVITATION', 'Retry the original request before starting another.');
    this.pending = Object.freeze({ kind, path, body: Object.freeze(structuredClone(body)), expected: Object.freeze(structuredClone(expected)),
      key: this.api.uuid(), epoch: this.epoch, generation: this.api.generation });
    return this.retry();
  }
  create(input) {
    this.requireSession(this.adminGeneration);
    if (!this.orgId) fail('ORGANIZATION_REQUIRED', 'Choose an organization first.');
    const parts = String(input.email || '').trim().split('@');
    const body = { email: parts.length === 2 ? parts[0] + '@' + parts[1].toLowerCase() : input.email, role: input.role, hours: input.hours };
    return this.start('create', `api/orgs/${this.orgId}/invitations`, body, { orgId: this.orgId, email: body.email, role: body.role });
  }
  revoke(id) {
    this.requireSession(this.adminGeneration);
    if (!this.orgId || !this.rows.some(row => row.id === id && row.status === 'pending')) fail('INVALID_INPUT', 'Choose a pending invitation from this page.');
    return this.start('revoke', `api/orgs/${this.orgId}/invitations/${id}/revoke`, {}, { orgId: this.orgId, invitationId: id });
  }
  accept() {
    if (!this.preview) fail('PREVIEW_REQUIRED', 'Review the invitation before accepting.');
    this.requireSession(this.previewGeneration);
    return this.start('accept', 'api/me/invitations/accept', { code: this.preview.code }, { orgId: this.preview.orgId, role: this.preview.role });
  }
  async retry() {
    const p = this.pending;
    if (!p) fail('NO_PENDING_INVITATION', 'There is no unconfirmed request.');
    this.requireSession(p.generation);
    if (p.epoch !== this.epoch) {
      if (this.pending === p) this.pending = null;
      fail('STALE_CONTEXT', 'Invitation context changed. Reconcile the earlier operation before continuing.');
    }
    if (this.flight?.pending === p) return this.flight.promise;
    const flight = { pending: p, promise: null };
    this.flight = flight;
    flight.promise = this.sendPending(p).finally(() => { if (this.flight === flight) this.flight = null; });
    return flight.promise;
  }
  async sendPending(p) {
    try {
      const r = await this.api.request(p.path, { method: 'POST', body: p.body, key: p.key });
      this.current(p.epoch, p.generation);
      if (this.pending !== p) fail('STALE_CONTEXT', 'Invitation context changed.');
      if (r?.requestId !== p.key || r.orgId !== p.expected.orgId) invalid();
      let result;
      if (p.kind === 'create') {
        if (!ID.test(r.invitationId || '') || r.email !== p.expected.email || r.role !== p.expected.role || r.status !== 'pending' ||
            !date(r.expiresAt) || !/^nvi1\.[A-Za-z0-9_-]{43}$/.test(r.code || '')) invalid();
        result = { kind: p.kind, orgId: r.orgId, invitationId: r.invitationId, email: r.email, role: r.role, expiresAt: r.expiresAt, code: r.code };
      } else if (p.kind === 'revoke') {
        if (r.invitationId !== p.expected.invitationId || r.status !== 'revoked') invalid();
        result = { kind: p.kind, orgId: r.orgId, invitationId: r.invitationId };
      } else {
        if (typeof r.alreadyMember !== 'boolean' || typeof r.organizationName !== 'string' || !r.organizationName ||
            !['OWNER','ADMIN',...ROLES].includes(r.role) || (!r.alreadyMember && r.role !== p.expected.role)) invalid();
        result = { kind: p.kind, orgId: r.orgId, organizationName: r.organizationName, role: r.role, alreadyMember: r.alreadyMember };
        this.preview = null; this.previewGeneration = null;
      }
      if (this.pending === p) this.pending = null;
      return result;
    } catch (e) {
      this.current(p.epoch, p.generation);
      if (this.pending === p && e.status >= 400 && e.status < 500 && ![408,429].includes(e.status)) this.pending = null;
      throw e;
    }
  }
}
