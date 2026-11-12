import { BrowserWorkspace, WorkspaceError } from './client.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ROLES = ['ADMIN', 'CONTRIBUTOR', 'REVIEWER', 'VIEWER'];
const fail = (code, message) => { throw new WorkspaceError(0, code, message); };
/** Reuses the HttpOnly session/CSRF transport; no identities or roles come from storage. */
export class ProjectTeamClient {
  constructor({ fetcher = fetch, uuid = () => crypto.randomUUID(), onSessionLost = () => {} } = {}) {
    this.uuid = uuid;
    this.transport = new BrowserWorkspace({ fetcher, uuid, onSessionLost: () => { this.clear(); onSessionLost(); } });
    this.clear();
  }
  clear() { this.projectId = null; this.members = []; this.next = null; this.after = null; this.actorId = null; this.pending = null; }
  get authenticated() { return this.transport.authenticated; }
  get projects() { return this.transport.projects; }
  get orgId() { return this.transport.orgId; }
  init() { return this.transport.init(); }
  async connect(orgId) {
    if (this.pending) fail('PENDING_WRITE', 'Retry the pending access change before switching organizations.');
    if (!this.authenticated || !UUID.test(orgId || '')) fail('INVALID_CONTEXT', 'Sign in and provide a valid organization UUID.');
    ++this.transport.generation; this.clear(); this.transport.orgId = orgId.toLowerCase(); this.transport.projects = [];
    await this.transport.refreshList();
    return this.projects;
  }
  async load(projectId, after = null) {
    if (this.pending) fail('PENDING_WRITE', 'Retry the pending access change before reloading.');
    if (!this.orgId || !UUID.test(projectId || '') || !this.projects.some(p => p.id === projectId) || (after && !UUID.test(after))) fail('INVALID_CONTEXT', 'Choose an authorized project.');
    const generation = ++this.transport.generation, org = this.orgId;
    this.members = []; this.next = null; this.actorId = null; this.projectId = projectId; this.after = after;
    const data = await this.transport.request(`api/orgs/${org}/projects/${projectId}/team?limit=50${after ? `&after=${after}` : ''}`);
    this.transport.assertCurrent(generation);
    if (!data || data.orgId !== org || data.projectId !== projectId || !UUID.test(data.actorId || '') || !Array.isArray(data.members) || data.members.length > 50 ||
        (data.next !== null && (!UUID.test(data.next || '') || data.next === after))) fail('INVALID_RESPONSE', 'The member directory did not match this project.');
    const ids = new Set();
    for (const member of data.members) {
      if (!UUID.test(member.userId || '') || ids.has(member.userId) || typeof member.email !== 'string' || member.email.length > 320 ||
          !['OWNER', ...ROLES].includes(member.organizationRole) || ![null, 'OWNER', ...ROLES].includes(member.role) ||
          !['active','organizationActive','editable'].every(k => typeof member[k] === 'boolean') ||
          !Number.isSafeInteger(member.accessRevision) || member.accessRevision < 0 ||
          ((member.role === null) !== (member.accessRevision === 0)) ||
          !Array.isArray(member.allowedRoles) || !member.allowedRoles.length || member.allowedRoles.some(r => !ROLES.includes(r)) ||
          (member.editable && (member.userId === data.actorId || member.role === 'OWNER'))) fail('INVALID_RESPONSE', 'Invalid member directory response.');
      ids.add(member.userId);
    }
    this.members = data.members; this.actorId = data.actorId; this.next = data.next;
    return data;
  }
  async change(userId, role, active) {
    if (this.pending) fail('PENDING_WRITE', 'Retry the pending access change first.');
    const member = this.members.find(m => m.userId === userId);
    if (!member || !member.editable || !ROLES.includes(role) || typeof active !== 'boolean' ||
        (active && (!member.organizationActive || !member.allowedRoles.includes(role))) || (!active && !member.role))
      fail('INVALID_CHANGE', 'This access change is not available.');
    this.pending = { path: `api/orgs/${this.orgId}/projects/${this.projectId}/team/commands`,
      orgId: this.orgId, projectId: this.projectId, generation: this.transport.generation, key: this.uuid(),
      body: { userId, role, active, expectedRevision: member.accessRevision } };
    return this.retry();
  }
  async retry() {
    const pending = this.pending;
    if (!pending) fail('NO_PENDING_WRITE', 'No pending access change.');
    try {
      const result = await this.transport.request(pending.path, { method: 'POST', key: pending.key, body: pending.body });
      this.transport.assertCurrent(pending.generation);
      if (!result || result.orgId !== pending.orgId || result.projectId !== pending.projectId || result.userId !== pending.body.userId ||
          result.requestId !== pending.key || result.role !== pending.body.role || result.active !== pending.body.active ||
          result.accessRevision !== pending.body.expectedRevision + 1) fail('SAVE_UNCONFIRMED', 'The response did not confirm this access change. Retry the original request.');
      this.pending = null;
      return result;
    } catch (error) {
      if (this.pending === pending && error.status >= 400 && error.status < 500) { this.pending = null; this.members = []; }
      throw error;
    }
  }
  async logout() { await this.transport.logout(); this.clear(); }
  expire() { ++this.transport.generation; this.transport.clear(); this.clear(); }
}
