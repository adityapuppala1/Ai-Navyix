import './app.mjs';
import { BrowserWorkspace } from './client.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LocalWorkbench = customElements.get('navyix-workbench');
/** Reuses every existing workflow screen; only transport, lifecycle and wording change. */
class NavyixConnectedWorkbench extends LocalWorkbench {
  constructor() {
    super(); this.phase = 'loading'; this.busy = false;
    this.api = new BrowserWorkspace({ onSessionLost: () => { this.phase = 'signedout'; this.render(); } });
    this.workspace = { projects: [], revision: 0 };
  }
  connectedCallback() {
    if (this.started) return;
    super.connectedCallback();
    // Server mode neither observes nor reads the local preview's workspace.
    window.removeEventListener('storage', this.storageHandler);
    if (!this.shadowRoot.querySelector('[data-connected-style]')) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./connected.css', import.meta.url).href;
      link.dataset.connectedStyle = ''; this.shadowRoot.append(link);
    }
    this.hide = () => { this.api.generation++; this.api.clear(); this.phase = 'loading'; this.render(); };
    this.show = event => { if (event.persisted) void this.load(); };
    window.addEventListener('pagehide', this.hide); window.addEventListener('pageshow', this.show);
    this.beforeLeave = event => { if (this.api.pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', this.beforeLeave);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('navyix-browser-session');
      this.channel.onmessage = event => { if (event.data === 'signed-out') { this.api.generation++; this.api.clear(); this.phase = 'signedout'; this.render(); } };
    }
  }
  disconnectedCallback() {
    window.removeEventListener('beforeunload', this.beforeLeave);
    window.removeEventListener('pagehide', this.hide); window.removeEventListener('pageshow', this.show);
    this.channel?.close(); clearTimeout(this.expiryTimer); this.api.generation++; this.api.clear(); super.disconnectedCallback();
  }
  get store() { throw new Error('Local storage is disabled in the connected workspace.'); }
  get project() { return this.api.project; }
  assessment(stage = this.stage) {
    const value = this.api.readiness[stage];
    if (!value) throw new Error('Server readiness is not loaded.');
    return value;
  }
  sync() { this.workspace = { projects: this.api.projects, revision: 0 }; this.projectId = this.api.project?.id || null; this.buildId = this.api.buildId; this.loadError = false; }
  async load() {
    if (this.api.pending) { this.error = 'Retry the unconfirmed save before reloading.'; this.renderAlert(); return; }
    this.phase = 'loading'; this.render();
    try {
      if (!this.api.authenticated && !await this.api.init()) { this.phase = 'signedout'; this.render(); return; }
      clearTimeout(this.expiryTimer);
      this.expiryTimer = setTimeout(() => { this.api.generation++; this.api.clear(); this.phase = 'signedout'; this.render(); }, Math.max(0, Date.parse(this.api.expiresAt) - Date.now()));
      if (this.api.orgId) {
        const selected = this.projectId || this.lastSavedId;
        await this.api.refreshList();
        const target = this.api.projects.some(p => p.id === selected) ? selected : this.api.projects[0]?.id;
        if (target) await this.api.load(target, this.buildId);
        this.phase = 'ready'; this.sync();
      } else this.phase = 'organization';
      this.error = ''; this.render();
    } catch (e) { this.failure(e, true); }
  }
  failure(error, full = false) {
    if (error.code === 'STALE_CONTEXT') return;
    this.error = error.message;
    if (error.status === 404) { this.api.projects = []; this.api.project = null; this.api.readiness = {}; this.phase = 'error'; }
    if (error.status === 401) this.phase = 'signedout'; else if (full || error.code === 'SAVED_REFRESH_FAILED') this.phase = 'error';
    if (full || this.phase !== 'ready') this.render(); else this.renderAlert();
  }
  setBusy(value) {
    this.busy = value;
    if (value) this.root.querySelectorAll('button:not(:disabled), select:not(:disabled)').forEach(el => { el.dataset.serverDisabled = ''; el.disabled = true; });
    else this.root.querySelectorAll('[data-server-disabled]').forEach(el => { delete el.dataset.serverDisabled; el.disabled = false; });
    this.pendingControls();
  }
  async mutate(fn, message) {
    // The shared project form creates a transient draft. Only its four input fields leave this browser.
    // Replace that transient UUID with the server-issued ID; never upload a local project aggregate.
    if (this.busy) return false;
    this.setBusy(true);
    try {
      const proposed = fn({ projects: [] }), draft = proposed.projects[0];
      if (proposed.projects.length !== 1 || draft.sample) throw new Error('Only an empty project may be created here.');
      const ack = await this.api.create({ name: draft.name, goal: draft.goal, owner: draft.owner, environment: draft.environment });
      draft.id = ack.projectId; this.lastSavedId = ack.projectId;
      await this.api.afterSave(ack); this.sync(); this.message = message; this.error = ''; return true;
    } catch (e) { this.failure(e); return false; }
    finally { this.setBusy(false); }
  }
  async command(type, input) {
    if (this.busy) return false;
    this.setBusy(true);
    try {
      const ack = await this.api.command(type, input); this.lastSavedId = ack.projectId;
      await this.api.afterSave(ack, type === 'build.add' ? null : this.buildId); this.sync();
      this.error = ''; this.message = type.endsWith('.review') ? 'Review recorded by the server. Readiness remains advisory.' : 'Saved to your organization’s server workspace.';
      return true;
    } catch (e) { this.failure(e); return false; }
    finally { this.setBusy(false); }
  }
  render() {
    if (!this.root) return;
    this.root.dataset.theme = this.theme;
    if (this.phase !== 'ready') {
      const state = this.phase;
      this.root.innerHTML = `<main class="server-shell"><section class="server-card"><a class="brand" href="/">NAVYIX</a><div class="eyebrow">DESIGN / BUILD / TEST / READINESS</div><h1>Your delivery story.<br><em>One connected workspace.</em></h1>
        <p>Work with your organization’s server records. Local preview data is never uploaded automatically.</p>
        ${this.error || new URLSearchParams(location.search).get('login') === 'failed' ? `<div class="alert error" role="alert">${escape(this.error || 'Sign-in was not completed. Please try again.')}</div>` : ''}
        ${state === 'loading' ? '<p role="status">Checking your session and workspace…</p>' : state === 'signedout' ? '<form action="/api/browser/login" method="post"><button class="btn primary" type="submit">Sign in with your organization →</button></form><small>Use the account provisioned by your administrator. No token paste or password is collected here.</small>' : state === 'organization' ? '<form id="organization-form"><label class="field">Organization ID<input name="orgId" required autocomplete="off" placeholder="Organization UUID from your administrator" maxlength="36"></label><button class="btn primary" type="submit">Connect workspace →</button></form><small>Knowing this ID does not grant access. The server checks your membership.</small>' : (this.api.pending ? '<button class="btn primary" data-action="retry-save">Retry same save</button>' : '<button class="btn primary" data-action="reload">Retry connection</button><button class="btn" data-action="organization">Switch organization</button>')}
        ${this.api.authenticated ? '<button class="btn" data-action="logout">Sign out</button>' : ''}<div class="server-boundary">Server sign-in · advisory readiness · approved access only</div></section></main>`;
      this.root.querySelector('#organization-form')?.addEventListener('submit', async event => {
        event.preventDefault(); if (this.busy) return; this.setBusy(true);
        try { const data = new FormData(event.currentTarget); await this.api.connect(String(data.get('orgId')).trim()); this.sync(); this.phase = 'ready'; this.error = ''; this.buildId = null; this.render(); }
        catch (e) { this.failure(e); } finally { this.setBusy(false); }
      });
      return;
    }
    super.render();
    const set = (selector, value) => { const el = this.root.querySelector(selector); if (el) el.textContent = value; };
    set('.local-card', `Organization · ${this.api.orgId}`);
    set('.top-actions .pill', 'Server · advisory');
    set('.boundary p', 'Server-connected workspace. Access and saves are checked by the backend. Build/test evidence is user-supplied, not independently verified. No CI or AI job is started here.');
    set('footer span:last-child', `Connected workbench · ${this.api.projects.length} project(s)`);
    set('.decision-banner .eyebrow', 'SERVER READINESS EVALUATION');
    this.root.querySelector('[data-action="sample"]')?.remove();
    this.root.querySelectorAll('.panel-head p').forEach(el => { if (el.textContent === 'Changes you have made in this browser.') el.textContent = 'Changes recorded in this server workspace.'; });
    this.root.querySelectorAll('.all-clear p').forEach(el => { el.textContent = 'This is a server-calculated advisory result, not authorization to deploy.'; });
    const controls = this.root.querySelector('.top-actions');
    for (const [action, text] of [['reload','Refresh'],['organization','Switch organization'],['logout','Sign out']]) {
      const b = document.createElement('button'); b.className = 'btn'; b.dataset.action = action; b.textContent = text; controls?.append(b);
    }
    this.renderAlert();
  }
  renderAlert() {
    super.renderAlert();
    const region = this.root?.querySelector('#alerts');
    region?.querySelector('[data-action="reload"]')?.replaceChildren(document.createTextNode('Reload from server'));
    if (region && this.api.pending) {
      const p = document.createElement('p'); p.textContent = 'Save unconfirmed. Retrying uses the same request ID and original body.';
      const b = document.createElement('button'); b.className = 'btn primary'; b.dataset.action = 'retry-save'; b.textContent = 'Retry same save'; region.append(p,b);
    }
    this.pendingControls();
  }
  pendingControls() {
    // The parent form keeps its modal open after a network failure. Keep a safe
    // retry INSIDE that modal, not hidden behind the dialog's inert backdrop.
    const form = this.shadowRoot?.querySelector('dialog form');
    if (!form) return;
    form.querySelector('[data-pending-controls]')?.remove();
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.hidden = Boolean(this.api.pending);
    if (this.api.pending) {
      for (const input of form.querySelectorAll('input,textarea,select')) {
        if (!input.disabled) { input.dataset.pendingDisabled = ''; input.disabled = true; }
      }
      const controls = document.createElement('div'); controls.dataset.pendingControls = '';
      controls.setAttribute('role', 'status');
      const note = document.createElement('p'); note.textContent = 'Save unconfirmed. Retry sends the original request once more; it does not submit edited values. Close this dialog to return to the workspace.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn primary';
      retry.dataset.action = 'retry-save'; retry.textContent = 'Retry same save'; retry.disabled = this.busy;
      controls.append(note, retry); form.append(controls);
    } else for (const input of form.querySelectorAll('[data-pending-disabled]')) { delete input.dataset.pendingDisabled; input.disabled = false; }
  }
  openForm(type, recordId) {
    if (this.api.pending) throw new Error('Resolve the pending save before editing.');
    super.openForm(type, recordId);
    const dialog = this.shadowRoot.querySelector('dialog');
    const label = dialog.querySelector('.eyebrow'); if (label) label.textContent = 'CONNECTED WORKFLOW';
    const note = dialog.querySelector('.form-actions span'); if (note) note.textContent = 'Saved through your organization’s access controls.';
    const fileHint = dialog.querySelector('#report-file + small'); if (fileHint) fileHint.textContent = 'Maximum 1 MB. Submitted reports are stored in your organization’s server project.';
  }
  async onClick(event) {
    const el = event.target.closest('[data-action]'); if (!el) return;
    const action = el.dataset.action;
    if (this.busy) return;
    try {
      if (['sample','reset','raw-export'].includes(action)) throw new Error('Local preview actions are unavailable in server mode.');
      if (action === 'logout') {
        this.setBusy(true); await this.api.logout(); this.channel?.postMessage('signed-out'); clearTimeout(this.expiryTimer);
        this.phase = 'signedout'; this.error = ''; this.render(); return;
      }
      if (this.api.pending && !['retry-save','nav','theme','close-dialog'].includes(action)) throw new Error('Retry the pending save before switching context or reloading.');
      if (action === 'organization') {
        this.api.generation++; this.api.orgId = null; this.api.projects = []; this.api.project = null; this.api.readiness = {};
        this.phase = 'organization'; this.error = ''; this.projectId = null; this.lastSavedId = null; this.buildId = null; this.render(); return;
      }
      if (action === 'retry-save') {
        const pending = this.api.pending;
        const buildId = pending?.path.endsWith('/commands') && pending.body.type !== 'build.add' ? this.buildId : null;
        this.setBusy(true); const ack = await this.api.retry(); this.lastSavedId = ack.projectId;
        await this.api.afterSave(ack, buildId); this.sync(); this.error = ''; this.message = 'The saved operation is confirmed.'; this.render(); return;
      }
      if (['export-project','export-assessment','template'].includes(action)) {
        if (!this.project) throw new Error('Choose a project.'); this.setBusy(true);
        let path = `api/orgs/${this.api.orgId}/projects/${this.project.id}`, name='navyix-project.json';
        if (action === 'export-assessment') { path += `/assessments/${el.dataset.id}`; name=`navyix-${el.dataset.id}.json`; }
        if (action === 'template') { if (!this.targetBuild || !this.project.testCases.length) throw new Error('Record a build and define tests first.'); path += `/report-template?buildId=${this.targetBuild.id}`; name='navyix-test-report-template.json'; }
        const generation = this.api.generation, data = await this.api.request(path); this.api.assertCurrent(generation); this.download(data,name); return;
      }
      await super.onClick(event);
      if (action === 'criterion') {
        const note=this.shadowRoot.querySelector('dialog .muted'); if(note) note.textContent='Server-returned records; user-supplied evidence is not independently verified.';
      }
    } catch (e) { this.failure(e); }
    finally { this.setBusy(false); }
  }
  async onChange(event) {
    if (this.busy) return;
    if (!['project-select','build-select'].includes(event.target.id)) { super.onChange(event); return; }
    if (this.api.pending) { this.error='Resolve the pending save before changing the target.'; this.render(); return; }
    const projectId=event.target.id==='project-select'?event.target.value:this.projectId;
    const buildId=event.target.id==='build-select'?event.target.value:null;
    if (!projectId) { this.api.generation++; this.api.project=null; this.api.readiness={}; this.projectId=null; this.render(); return; }
    this.phase='loading'; this.render();
    try { await this.api.load(projectId,buildId); this.buildId=buildId; this.sync(); this.phase='ready'; this.error=''; this.render(); }
    catch(e){this.failure(e,true);}
  }
}
if (!customElements.get('navyix-connected-workbench')) customElements.define('navyix-connected-workbench', NavyixConnectedWorkbench);
