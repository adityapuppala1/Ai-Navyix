/** Browser-only adapter. No bearer tokens, localStorage, or automatic local-data transfer. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages = ['design', 'build', 'test', 'release'];
export class WorkspaceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const error = (code, message) => new WorkspaceError(0, code, message);
export class BrowserWorkspace {
  constructor({ fetcher = fetch, uuid = () => crypto.randomUUID(), onSessionLost = () => {} } = {}) {
    this.fetcher = fetcher; this.uuid = uuid; this.onSessionLost = onSessionLost; this.generation = 0;
    this.clear();
  }
  clear() { this.authenticated = false; this.csrf = null; this.expiresAt = null; this.orgId = null; this.projects = []; this.project = null; this.buildId = null; this.readiness = {}; this.pending = null; }
  assertCurrent(version) { if (version !== this.generation) throw error('STALE_CONTEXT', 'Workspace context changed.'); }
  async request(path, { body, key, method = 'GET' } = {}) {
    const generation = this.generation;
    const headers = { accept: 'application/json' };
    if (method === 'POST') { headers['content-type'] = 'application/json'; headers['x-navyix-csrf'] = this.csrf || ''; if (key) headers['idempotency-key'] = key; }
    let response, value;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      response = await this.fetcher('/api/browser/' + path, { method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      value = await response.json();
    } catch { this.assertCurrent(generation); throw error('NETWORK_UNCONFIRMED', 'The server did not confirm the operation. Retry the same request.'); }
    finally { clearTimeout(timer); }
    this.assertCurrent(generation);
    if (response.status === 401) {
      this.generation++; this.clear(); this.onSessionLost();
      throw new WorkspaceError(401, 'SESSION_EXPIRED', 'Your session expired. Sign in again.');
    }
    if (!response.ok) throw new WorkspaceError(response.status, value?.error?.code || 'REQUEST_FAILED', value?.error?.message || 'The request could not be completed.');
    return value;
  }
  async init() {
    const generation = this.generation;
    try {
      const session = await this.request('session'); this.assertCurrent(generation);
      if (session?.authenticated !== true || typeof session.csrfToken !== 'string' || !session.csrfToken || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw error('INVALID_SESSION', 'Invalid session response.');
      this.authenticated = true; this.csrf = session.csrfToken; this.expiresAt = session.expiresAt; return true;
    } catch (e) { if (e.status === 401) return false; throw e; }
  }
  async connect(orgId) {
    if (!this.authenticated) throw error('SIGN_IN_REQUIRED', 'Sign in first.');
    if (this.pending) throw error('PENDING_WRITE', 'Resolve the pending save before switching organizations.');
    if (!UUID.test(orgId || '')) throw error('INVALID_ORGANIZATION', 'Use the organization UUID provided by your administrator.');
    const generation = ++this.generation;
    this.orgId = orgId.toLowerCase(); this.projects = []; this.project = null; this.readiness = {};
    await this.refreshList(generation); this.assertCurrent(generation);
    if (this.projects.length) await this.load(this.projects[0].id);
  }
  async refreshList(generation = this.generation) {
    const org = this.orgId; let after = null; const projects = [], seen = new Set();
    for (let page = 0; page < 3; page++) {
      const data = await this.request(`api/orgs/${org}/projects?limit=50${after ? `&after=${after}` : ''}`);
      this.assertCurrent(generation);
      if (!Array.isArray(data.projects)) throw error('INVALID_RESPONSE', 'Invalid project list.');
      for (const project of data.projects) {
        if (!UUID.test(project.id || '') || seen.has(project.id) || projects.length >= 100) throw error('INVALID_RESPONSE', 'Unexpected project list.');
        seen.add(project.id); projects.push(project);
      }
      if (!data.next) { this.projects = projects; return; }
      if (!UUID.test(data.next) || after === data.next) throw error('INVALID_RESPONSE', 'Invalid page cursor.');
      after = data.next;
    }
    throw error('PROJECT_LIMIT', 'The server returned too many projects.');
  }
  async load(projectId, buildId = null) {
    if (this.pending) throw error('PENDING_WRITE', 'Resolve the pending save before reloading.');
    if (!UUID.test(projectId || '')) throw error('INVALID_PROJECT', 'Choose a project.');
    const generation = ++this.generation, org = this.orgId;
    this.project = null; this.readiness = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = await this.request(`api/orgs/${org}/projects/${projectId}`); this.assertCurrent(generation);
      if (p.id !== projectId || !Array.isArray(p.builds) || !Number.isSafeInteger(p.revision)) throw error('INVALID_RESPONSE', 'Invalid project response.');
      const target = buildId === null ? p.builds.at(-1)?.id : buildId || undefined;
      const selectedBuild = target ? p.builds.find(build => build.id === target) : null;
      if (target && !selectedBuild) throw error('INVALID_BUILD', 'The selected build does not belong to this project.');
      const entries = await Promise.all(stages.map(async stage => {
        const q = new URLSearchParams({ stage, environment: p.environment }); if (target) q.set('buildId', target);
        const result = await this.request(`api/orgs/${org}/projects/${projectId}/readiness?${q}`);
        return [stage, result];
      }));
      this.assertCurrent(generation);
      if (entries.some(([, a]) => a?.projectId !== p.id || a?.projectRevision !== p.revision)) continue;
      if (entries.some(([stage, a]) => a.stage !== stage || a.environment !== p.environment ||
          a.buildId !== (target || null) || a.artifactDigest !== (selectedBuild?.artifactDigest || null) ||
          !Array.isArray(a.criteria) || !['Ready', 'Blocked', 'Insufficient evidence', 'Ready with accepted conditions'].includes(a.status)))
        throw error('INVALID_RESPONSE', 'Readiness does not match the selected activity, artifact and environment.');
      this.project = p; this.buildId = buildId; this.readiness = Object.fromEntries(entries); return p;
    }
    throw error('REVISION_CHANGED', 'The project changed while loading. Reload before editing.');
  }
  async save(path, body) {
    if (this.pending) throw error('PENDING_WRITE', 'Retry the pending save before starting another one.');
    this.pending = { path, body: structuredClone(body), key: this.uuid(), generation: this.generation };
    return this.retry();
  }
  async retry() {
    const pending = this.pending;
    if (!pending) throw error('NO_PENDING_WRITE', 'There is no save to retry.');
    try {
      const ack = await this.request(pending.path, { method: 'POST', body: pending.body, key: pending.key });
      this.assertCurrent(pending.generation);
      this.pending = null;
      return ack;
    } catch (e) {
      if (this.pending === pending && e.status >= 400 && e.status < 500) this.pending = null;
      throw e;
    }
  }
  async create(input) {
    if (!this.orgId) throw error('ORGANIZATION_REQUIRED', 'Connect an organization first.');
    return this.save(`api/orgs/${this.orgId}/projects`, input);
  }
  async command(type, input) {
    if (!this.project) throw error('PROJECT_REQUIRED', 'Choose a project.');
    return this.save(`api/orgs/${this.orgId}/projects/${this.project.id}/commands`, { expectedRevision: this.project.revision, type, input });
  }
  async afterSave(ack, buildId = null) {
    try { await this.refreshList(); return await this.load(ack.projectId, buildId); }
    catch (e) {
      if (e.status === 401 || e.code === 'STALE_CONTEXT') throw e;
      throw error('SAVED_REFRESH_FAILED', 'The server saved your change, but reloading failed. Reload; do not submit it again.');
    }
  }
  async logout() {
    try { await this.request('logout', { method: 'POST', body: {} }); }
    catch (e) { if (e.status !== 401) throw e; }
    this.generation++; this.clear();
  }
}
