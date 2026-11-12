import { OrganizationDirectory } from './organization-client.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class NavyixOrganizationPicker extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: 'open' }); this.busy = false; this.error = ''; this.directory = null;
    this.shadowRoot.addEventListener('click', event => { void this.action(event); });
  }
  connectedCallback() { this.render(); }
  disconnectedCallback() { this.directory?.dispose(); }
  configure(workspace) {
    this.directory?.dispose(); this.busy = false; this.workspace = workspace; this.directory = new OrganizationDirectory(workspace);
    void this.load();
  }
  async load(after = null) {
    if (!this.directory || this.busy) return;
    const directory = this.directory;
    this.busy = true; this.error = ''; this.render();
    try { await directory.load(after); }
    catch (e) {
      if (directory !== this.directory || !this.isConnected || e.code === 'STALE_CONTEXT') return;
      this.error = e.status === 404 ? 'Organization selection is not enabled. Contact your administrator.' : e.message;
    } finally {
      if (directory === this.directory && this.isConnected) { this.busy = false; this.render(); this.shadowRoot.querySelector('h2')?.focus({ preventScroll: true }); }
    }
  }
  async action(event) {
    const button = event.target.closest('button');
    if (!button || this.busy || !this.directory) return;
    if (button.dataset.action === 'reload') return this.load();
    if (button.dataset.action === 'next') return this.load(this.directory.next);
    if (button.dataset.id) {
      try {
        const orgId = this.directory.select(button.dataset.id);
        this.busy = true; this.render();
        const accepted = !this.dispatchEvent(new CustomEvent('navyix-organization-selected', {
          detail: { orgId }, bubbles: true, composed: true, cancelable: true
        }));
        // A disconnected or busy parent must not leave the picker permanently disabled.
        if (!accepted) { this.busy = false; this.error = 'The workspace could not accept this selection. Please retry.'; this.render(); }
      } catch (e) { this.busy = false; this.error = e.message; this.render(); }
    }
  }
  render() {
    const rows = this.directory?.rows || [];
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:inherit;font:inherit}*{box-sizing:border-box}h2{font-size:1.15rem;line-height:1.4;margin:16px 0 6px;outline:none}h2:focus-visible{outline:2px solid #5eead4}
      p{font-size:.9rem;line-height:1.55;color:#b9c4d8;margin:0 0 16px}.list{display:grid;gap:10px}button{font:inherit;cursor:pointer;border:1px solid #33465e;border-radius:12px;color:#ecf5ff;background:#112238;padding:14px 16px;text-align:left;min-height:48px;transition:border-color .16s ease,transform .16s ease}button:hover{border-color:#5eead4;transform:translateY(-1px)}button:focus-visible{outline:3px solid #5eead4;outline-offset:3px}button:disabled{cursor:wait;opacity:.65;transform:none}.choose{display:flex;gap:12px;justify-content:space-between;align-items:center;width:100%;min-width:0}.name{font-weight:650;overflow-wrap:anywhere;min-width:0}.role{font-size:.72rem;letter-spacing:.05em;color:#8bddd5;flex-shrink:0}.foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.error{padding:12px;border:1px solid #ad6179;border-radius:10px;color:#ffd5df;background:#3c2030}.empty{padding:18px;border:1px dashed #33465e;border-radius:12px}.small{font-size:.8rem;margin-top:14px}
      @media(max-width:420px){.choose{align-items:flex-start;flex-direction:column;gap:5px}}@media(prefers-reduced-motion:reduce){button{transition:none;transform:none!important}}
      </style><section aria-label="Your organizations" aria-busy="${this.busy}">
      <h2 tabindex="-1">Choose your organization</h2><p>Only active memberships for your signed-in account appear here.</p>
      ${this.error ? `<p class="error" role="alert">${escape(this.error)}</p>` : ''}
      ${this.busy && !rows.length ? '<p role="status">Loading your organizations…</p>' : !rows.length && !this.error ? '<div class="empty"><strong>No active organization membership</strong><p>Ask your organization administrator to add this account. Knowing an organization ID does not grant access.</p></div>' : ''}
      ${this.busy && rows.length ? '<p role="status">Opening your organization…</p>' : ''}
      <div class="list">${rows.map(row => `<button class="choose" type="button" data-id="${row.id}" ${this.busy ? 'disabled' : ''}><span class="name">${escape(row.name)}</span><span class="role">${escape(row.role)}</span></button>`).join('')}</div>
      <div class="foot"><button type="button" data-action="reload" ${this.busy ? 'disabled' : ''}>Refresh organizations</button>${this.directory?.next ? `<button type="button" data-action="next" ${this.busy ? 'disabled' : ''}>Next page →</button>` : ''}</div>
      <p class="small">Selecting an organization does not change membership or project permissions.</p></section>`;
  }
}
if (!customElements.get('navyix-organization-picker')) customElements.define('navyix-organization-picker', NavyixOrganizationPicker);
