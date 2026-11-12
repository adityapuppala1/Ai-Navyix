/** Same-session directory reads. Display roles are NOT an authorization decision. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROLES = new Set(['OWNER','ADMIN','CONTRIBUTOR','REVIEWER','VIEWER']);
const error = (code, message) => Object.assign(new Error(message), { code });
export class OrganizationDirectory {
  constructor(workspace) { this.workspace = workspace; this.epoch = 0; this.clear(); }
  clear() { this.rows = []; this.next = null; this.context = null; }
  dispose() { this.epoch++; this.clear(); }
  async load(after = null) {
    if (after !== null && !UUID.test(after)) throw error('INVALID_CURSOR', 'Invalid organization page.');
    if (!this.workspace.authenticated) { this.dispose(); throw error('SIGN_IN_REQUIRED', 'Sign in first.'); }
    if (this.workspace.pending) throw error('PENDING_WRITE', 'Resolve the unconfirmed save first.');
    const epoch = ++this.epoch, context = this.workspace.generation;
    this.clear();
    try {
      const result = await this.workspace.request(`api/me/organizations?limit=20${after ? '&after=' + after : ''}`);
      if (epoch !== this.epoch || context !== this.workspace.generation || !this.workspace.authenticated)
        throw error('STALE_CONTEXT', 'Workspace changed.');
      if (!result || !Array.isArray(result.organizations) || result.organizations.length > 20 ||
          !(result.next === null || UUID.test(result.next || ''))) throw error('INVALID_DIRECTORY', 'Invalid organization response.');
      let previous = after;
      const rows = result.organizations.map(row => {
        if (!row || !UUID.test(row.id || '') || (previous && row.id <= previous) || typeof row.name !== 'string' ||
            !row.name.trim() || row.name.length > 200 || !ROLES.has(row.role)) throw error('INVALID_DIRECTORY', 'Invalid organization response.');
        previous = row.id;
        return Object.freeze({ id: row.id, name: row.name, role: row.role });
      });
      if (result.next !== null && (rows.length !== 20 || result.next !== rows.at(-1).id))
        throw error('INVALID_DIRECTORY', 'Invalid organization page cursor.');
      this.rows = rows; this.next = result.next; this.context = context; return rows;
    } catch (e) {
      if (epoch !== this.epoch || context !== this.workspace.generation) throw error('STALE_CONTEXT', 'Workspace changed.');
      this.clear(); throw e;
    }
  }
  select(id) {
    if (!this.workspace.authenticated || this.context !== this.workspace.generation) {
      this.dispose(); throw error('STALE_CONTEXT', 'Sign in or reload the organization list.');
    }
    if (this.workspace.pending) throw error('PENDING_WRITE', 'Resolve the unconfirmed save first.');
    const row = this.rows.find(item => item.id === id);
    if (!row) throw error('INVALID_ORGANIZATION', 'Choose an organization from this page.');
    return row.id; // The subsequent project API still rechecks database membership.
  }
}
