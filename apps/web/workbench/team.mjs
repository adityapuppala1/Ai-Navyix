import { ProjectTeamClient } from './team-client.mjs';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Project access panel. All decisions are rechecked by the backend/database. */
export class ProjectTeamPanel extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: 'open' }); this.busy = false; this.message = ''; this.confirmation = null;
    this.client = new ProjectTeamClient({ onSessionLost: () => { this.message = 'Session expired. Sign in again.'; this.confirmation = null; this.render(); } });
  }
  connectedCallback() {
    if (!this.bound) {
      this.shadowRoot.addEventListener('click', event => this.click(event));
      this.shadowRoot.addEventListener('submit', event => this.submit(event)); this.bound = true;
    }
    try { this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('navyix-browser-session') : null; }
    catch { this.channel = null; } // Some privacy modes disallow cross-tab messaging.
    this.channel?.addEventListener('message', event => { if (event.data !== 'signed-out') return; clearTimeout(this.expiryTimer); this.client.expire(); this.confirmation = null; this.message = 'Session changed in another tab. Sign in again.'; this.render(); });
    this.visibility = () => { if (document.visibilityState === 'visible' && this.client.authenticated && Date.parse(this.client.transport.expiresAt) <= Date.now()) { this.client.expire(); this.confirmation = null; this.message = 'Session expired.'; this.render(); } };
    document.addEventListener('visibilitychange', this.visibility);
    this.work(async () => { if (await this.client.init()) { this.expiryTimer = setTimeout(() => { this.client.expire(); this.confirmation = null; this.message = 'Session expired. Sign in again.'; this.render(); }, Math.max(0, Date.parse(this.client.transport.expiresAt) - Date.now())); } });
  }
  disconnectedCallback() { clearTimeout(this.expiryTimer); this.channel?.close(); document.removeEventListener('visibilitychange', this.visibility); this.client.expire(); }
  async work(task) {
    if (this.busy) return;
    this.busy = true; this.message = ''; this.messageKind = 'error'; this.render();
    try { await task(); }
    catch (error) { if (error.code !== 'STALE_CONTEXT') this.message = error.message || 'The operation could not be completed.'; }
    finally { this.busy = false; if (this.isConnected) this.render(); }
  }
  render() {
    const c = this.client, disabled = this.busy || Boolean(c.pending);
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/workbench/team.css">
      <main><header><a class="brand" href="/workspace" aria-label="Back to Navyix workspace"><span>N</span> NAVYIX</a><span class="eyebrow">TEAM & ACCESS</span>
      ${c.authenticated ? '<button data-action="logout" class="quiet">Sign out</button>' : ''}</header>
      <section class="heading"><div class="eyebrow">DESIGN · BUILD · TEST · READINESS</div><h1>The right people.<br><em>The right access.</em></h1>
      <p>Bring contributors and reviewers into your project, with explicit permissions and an audit trail.</p></section>
      <aside class="notice">Project access only. Organization onboarding, invitations, and owner transfers are not available here.</aside>
      ${this.message ? `<p role="${this.messageKind === 'success' ? 'status' : 'alert'}" class="alert ${this.messageKind === 'success' ? 'success' : ''}">${e(this.message)}</p>` : ''}
      ${c.pending ? `<div class="pending" role="status"><div><strong>Access change not confirmed</strong><p>Keep the original request. Do not submit a different change.</p></div><button data-action="retry" ${this.busy ? 'disabled' : ''}>Retry same request</button></div>` : ''}
      ${!c.authenticated ? `<section class="empty"><h2>Sign in to manage project access</h2><p>Your organization and project must both grant you owner or administrator access.</p><form action="/api/browser/login" method="post"><button type="submit">Sign in securely</button></form></section>` : `
      <section class="controls" aria-label="Organization and project"><form data-form="organization"><label for="org">Organization ID</label><div class="inline"><input id="org" name="org" required value="${e(c.orgId)}" placeholder="Organization UUID" ${disabled ? 'disabled' : ''}><button ${disabled ? 'disabled' : ''}>Connect</button></div></form>
      <form data-form="project"><label for="project">Project</label><div class="inline"><select id="project" name="project" ${disabled || !c.projects.length ? 'disabled' : ''}>
      ${!c.projects.length ? '<option value="">Connect an organization first</option>' : c.projects.map(p=>`<option value="${e(p.id)}" ${p.id===c.projectId?'selected':''}>${e(p.name)}</option>`).join('')}
      </select><button ${disabled || !c.projects.length ? 'disabled' : ''}>Open team</button></div></form></section>
      <section class="team"><div class="section-head"><div><h2>Project team</h2><p>${c.members.length ? `${c.members.length} organization members on this page` : 'Choose a project to view its organization member directory.'}</p></div><button class="quiet" data-action="reload" ${disabled || !c.projectId ? 'disabled' : ''}>Refresh</button></div>
      <div class="member-list" aria-busy="${this.busy}">${c.members.map(m => `<article class="member"><div class="identity"><span class="avatar" aria-hidden="true">${e(m.email.slice(0,1).toUpperCase())}</span><div><strong>${e(m.email)}</strong><small>Organization: ${e(m.organizationRole.toLowerCase())}${!m.organizationActive ? ' · inactive' : ''}</small></div></div>
      <div class="access"><span class="badge ${m.active ? 'on' : ''}">${m.role ? e(m.active ? m.role.toLowerCase() : 'access revoked') : 'not added'}</span><small>Revision ${m.accessRevision}</small></div>
      ${!m.editable ? `<p class="protected">${m.userId===c.actorId ? 'Your access · protected' : 'Owner · protected'}</p>` : `<form data-form="member" data-user="${e(m.userId)}"><label class="sr-only" for="role-${e(m.userId)}">Project role for ${e(m.email)}</label><select id="role-${e(m.userId)}" name="role" ${disabled || !m.organizationActive ? 'disabled' : ''}>${m.allowedRoles.map(role=>`<option ${role===m.role?'selected':''}>${e(role)}</option>`).join('')}</select><button ${disabled || !m.organizationActive ? 'disabled' : ''}>${m.active ? 'Change role' : 'Grant access'}</button>${m.active ? `<button type="button" class="danger" data-action="revoke" data-user="${e(m.userId)}" ${disabled ? 'disabled' : ''}>Revoke</button>` : ''}</form>`}</article>`).join('') || `<div class="empty"><h3>${this.busy ? 'Loading authorized members…' : 'No member directory loaded'}</h3><p>No customer records are stored in this browser.</p></div>`}</div>
      <div class="pagination"><button class="quiet" data-action="first" ${disabled || !c.after ? 'disabled' : ''}>First page</button><button class="quiet" data-action="next" ${disabled || !c.next ? 'disabled' : ''}>Next page →</button></div></section>`}
      <footer><span>Least privilege. Explicit changes. Traceable decisions.</span><a href="/workspace">Back to engineering workspace →</a></footer></main>
      ${this.confirmation ? `<dialog aria-labelledby="confirm-title"><form data-form="confirm"><div class="eyebrow">CONFIRM ACCESS CHANGE</div><h2 id="confirm-title">${this.confirmation.active?'Update project access?':'Revoke project access?'}</h2><p><strong>${e(this.confirmation.email)}</strong></p><p>Project: ${e(c.projects.find(p => p.id === c.projectId)?.name)}<br><small>Organization: ${e(c.orgId)}</small></p><p>${this.confirmation.active ? `Grant ${e(this.confirmation.role.toLowerCase())} access to the selected project.` : 'Remove this member’s access to the selected project. Organization membership is unchanged.'}</p><p class="muted">The server checks your current authority and membership revision before saving.</p><div class="dialog-actions"><button type="button" class="quiet" data-action="cancel">Cancel</button><button type="submit">Confirm change</button></div></form></dialog>` : ''}`;
    const dialog = this.shadowRoot.querySelector('dialog');
    if (dialog) { dialog.showModal(); dialog.addEventListener('cancel', event => { event.preventDefault(); this.confirmation = null; this.render(); }); dialog.querySelector('[data-action="cancel"]').focus(); }
  }
  confirm(userId, role, active) {
    const m = this.client.members.find(member => member.userId === userId);
    if (!m?.editable || this.busy || this.client.pending) return;
    this.confirmation = { userId, email: m.email, role, active }; this.render();
  }
  submit(event) {
    const form = event.target, type = form.dataset.form;
    if (!type) return; event.preventDefault(); if (this.busy || this.client.pending) return;
    const data = new FormData(form);
    if (type === 'organization') return this.work(() => this.client.connect(String(data.get('org') || '').trim()));
    if (type === 'project') return this.work(() => this.client.load(String(data.get('project') || '')));
    if (type === 'member') return this.confirm(form.dataset.user, String(data.get('role')), true);
    if (type === 'confirm' && this.confirmation) {
      const change = this.confirmation; this.confirmation = null;
      return this.work(async () => { await this.client.change(change.userId, change.role, change.active); await this.refreshAfterSave(); });
    }
  }
  async refreshAfterSave() {
    try { await this.client.load(this.client.projectId, this.client.after); this.message = 'Project access updated and recorded.'; this.messageKind = 'success'; }
    catch (error) { if (error.status === 401 || error.code === 'STALE_CONTEXT') throw error; this.message = 'Access change saved, but refresh failed. Refresh the directory; do not submit again.'; }
  }
  click(event) {
    const button = event.target.closest('[data-action]'); if (!button || button.disabled || this.busy) return;
    const action = button.dataset.action, c = this.client;
    if (action === 'cancel') { this.confirmation = null; this.render(); return; }
    if (action === 'revoke') { const m=c.members.find(m=>m.userId===button.dataset.user); if(m) this.confirm(m.userId,m.role,false); return; }
    if (action === 'retry') return this.work(async () => { await c.retry(); await this.refreshAfterSave(); });
    if (action === 'reload' || action === 'first' || action === 'next') return this.work(() => c.load(c.projectId,action==='next'?c.next:action==='first'?null:c.after));
    if (action === 'logout') return this.work(async () => { await c.logout(); clearTimeout(this.expiryTimer); this.channel?.postMessage('signed-out'); });
  }
}
if (!customElements.get('navyix-project-team')) customElements.define('navyix-project-team', ProjectTeamPanel);
