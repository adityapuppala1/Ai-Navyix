import { BrowserWorkspace } from './client.mjs';
import { InvitationClient } from './invitation-client.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => new Date(value).toLocaleString();
class NavyixInvitations extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: 'open' }); this.orgs = []; this.phase = 'loading'; this.error = ''; this.notice = ''; this.busy = false; this.draft = { email: '', role: 'VIEWER', hours: 24 };
    this.api = new BrowserWorkspace({ onSessionLost: () => this.signedOut() }); this.client = new InvitationClient(this.api);
    this.shadowRoot.addEventListener('click', e => { void this.click(e); });
    this.shadowRoot.addEventListener('submit', e => { void this.submit(e); });
    this.shadowRoot.addEventListener('change', e => { if (e.target.id === 'org') { this.created = null; this.notice = ''; this.draft = { email: '', role: 'VIEWER', hours: 24 }; void this.task(() => this.client.list(e.target.value)); } });
  }
  connectedCallback() {
    if (this.started) return; this.started = true; this.render(); void this.initialize();
    if (typeof BroadcastChannel !== 'undefined') { this.channel = new BroadcastChannel('navyix-browser-session'); this.channel.onmessage = e => { if (e.data === 'signed-out') this.signedOut(); }; }
    this.pagehide = () => this.signedOut(); window.addEventListener('pagehide', this.pagehide);
  }
  disconnectedCallback() { this.started = false; this.client.reset(); this.api.generation++; this.api.clear(); this.created = null; this.channel?.close(); clearTimeout(this.timer); window.removeEventListener('pagehide', this.pagehide); }
  signedOut() { this.busy = false; this.api.generation++; this.api.clear(); this.client.reset(); this.created = null; this.orgs = []; this.draft = { email: '', role: 'VIEWER', hours: 24 }; this.phase = 'signedout'; this.error = ''; this.notice = ''; clearTimeout(this.timer); this.render(); }
  async initialize() {
    try {
      if (!await this.api.init()) { this.phase = 'signedout'; this.render(); return; }
      this.phase = 'ready';
      this.timer = setTimeout(() => this.signedOut(), Math.max(0, Date.parse(this.api.expiresAt) - Date.now()));
      await this.organizations();
    } catch (e) { if (e.code !== 'STALE_CONTEXT') this.error = e.message; }
    if (this.isConnected) this.render();
  }
  async organizations() {
    const generation = this.api.generation;
    const page = await this.api.request('api/me/organizations?limit=50'); this.api.assertCurrent(generation);
    if (!Array.isArray(page.organizations)) throw new Error('Organization directory is unavailable.');
    this.orgs = page.organizations.filter(x => ['OWNER','ADMIN'].includes(x.role));
    // Pilot lists the first directory page only; do not silently claim a complete organization listing.
    this.moreOrganizations = Boolean(page.next);
  }
  async task(work) {
    if (this.busy || this.phase !== 'ready') return;
    this.busy = true; this.error = ''; const generation = this.api.generation; this.render();
    try { const result = await work(); this.api.assertCurrent(generation); if (result?.kind) await this.saved(result); }
    catch (e) { if (generation === this.api.generation && e.code !== 'STALE_CONTEXT') { this.error = e.message; if ([403,404].includes(e.status)) { this.created = null; this.client.rows = []; this.client.preview = null; } } }
    finally { if (generation === this.api.generation && this.isConnected) { this.busy = false; this.render(); this.shadowRoot.querySelector('[role="alert"], [role="status"]')?.focus(); } }
  }
  async saved(result) {
    this.notice = result.kind === 'accept' ? `Membership confirmed in ${result.organizationName}. Project access is assigned separately.` : result.kind === 'revoke' ? 'Invitation revoked.' : 'Invitation created. Share the code privately with the named recipient. No email was sent.';
    this.created = result.kind === 'create' ? result : null;
    if (result.kind === 'create') this.draft = { email: '', role: 'VIEWER', hours: 24 };
    if (result.kind === 'accept') { await this.organizations(); return; }
    try { await this.client.list(result.orgId); }
    catch { this.notice += ' The save was confirmed, but the list could not refresh. Do not submit the creation again.'; }
  }
  async submit(event) {
    const form = event.target;
    if (!['invite-form','code-form'].includes(form.id)) return; // Keep ordinary sign-in POST navigation.
    event.preventDefault(); const data = new FormData(form);
    if (form.id === 'invite-form') {
      const input = { email: String(data.get('email')).trim(), role: String(data.get('role')), hours: Number(data.get('hours')) };
      this.draft = input; await this.task(() => this.client.create(input));
    } else { const code = String(data.get('code')).trim(); await this.task(() => this.client.inspect(code)); }
  }
  async click(event) {
    const b = event.target.closest('[data-action]'); if (!b || this.busy) return;
    const action = b.dataset.action;
    if (action === 'logout') { await this.task(async () => { await this.api.logout(); this.channel?.postMessage('signed-out'); this.signedOut(); }); return; }
    if (action === 'copy') {
      try { await navigator.clipboard.writeText(this.created.code); this.notice = 'Code copied. Share it only with the invited recipient.'; } catch { this.notice = 'Select the code field and copy it manually.'; }
      this.render(); return;
    }
    if (action === 'hide-code') { this.created = null; this.render(); return; }
    if (action === 'retry') { await this.task(() => this.client.retry()); return; }
    if (this.client.pending) { this.error = 'Resolve the unconfirmed invitation operation first.'; this.render(); return; }
    if (action === 'refresh') { await this.task(() => this.client.list(this.client.orgId)); return; }
    if (action === 'next') { await this.task(() => this.client.list(this.client.orgId, this.client.next)); return; }
    if (action === 'cancel-preview') { this.client.preview = null; this.render(); return; }
    if (action === 'accept') { await this.task(() => this.client.accept()); return; }
    if (action === 'revoke') {
      const row = this.client.rows.find(x => x.id === b.dataset.id); if (!row) return;
      const dialog = this.shadowRoot.querySelector('dialog');
      dialog.querySelector('p').textContent = `Revoke the invitation for ${row.email}? This does not remove an already accepted membership.`;
      dialog.showModal(); dialog.querySelector('[value="cancel"]').focus();
      dialog.addEventListener('close', () => { if (dialog.returnValue === 'confirm') void this.task(() => this.client.revoke(row.id)); }, { once: true });
    }
  }
  render() {
    const disabled = this.busy || Boolean(this.client.pending), p = this.client.preview;
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/workbench/invitations.css"><main>
      <header><a class="brand" href="/workspace">NAVYIX<span>ENGINEERING READINESS</span></a><a href="/workspace">← Workspace</a>${this.api.authenticated ? '<button data-action="logout">Sign out</button>' : ''}</header>
      <div class="eyebrow">WORKSPACE / PEOPLE</div><h1>Bring the right people<br><em>into the right workspace.</em></h1>
      <p class="intro">Invite collaborators with a defined role. Confirm identity before membership. Keep project access separate.</p>
      ${this.error ? `<div role="alert" tabindex="-1" class="error">${esc(this.error)}</div>` : ''}${this.notice ? `<div role="status" tabindex="-1" class="notice">${esc(this.notice)}</div>` : ''}
      ${this.client.pending ? '<div class="error" role="status">Response unconfirmed. Do not create a second request.<button data-action="retry">Retry original request</button></div>' : ''}
      ${this.phase === 'loading' ? '<p role="status">Checking your session…</p>' : this.phase === 'signedout' ? '<section><h2>Sign in to continue</h2><p>Use the account matching your invitation. After sign-in, return to Invitations from the workspace.</p><form method="post" action="/api/browser/login"><button class="primary">Sign in securely →</button></form></section>' : `<div class="columns">
      <section><div class="eyebrow">01 / INVITE A COLLABORATOR</div><h2>Grow your team, deliberately.</h2><p>Only organization owners and administrators can create or revoke invitations.</p>
      <label for="org">Organization</label><select id="org" ${disabled ? 'disabled' : ''}><option value="" disabled ${!this.client.orgId ? 'selected' : ''}>Choose an organization</option>${this.orgs.map(o => `<option value="${esc(o.id)}" ${o.id === this.client.orgId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      ${this.moreOrganizations ? '<p>Only the first organization-directory page is available in this pilot screen.</p>' : ''}
      ${!this.orgs.length ? '<p>No administrable organizations on this page. You can still accept an invitation below.</p>' : ''}
      <form id="invite-form"><fieldset ${disabled || !this.client.orgId ? 'disabled' : ''}><label for="email">Recipient email</label><input id="email" name="email" type="email" maxlength="254" required autocomplete="off" placeholder="colleague@company.com" value="${esc(this.draft.email)}">
      <div class="pair"><div><label for="role">Organization role</label><select id="role" name="role"><option value="VIEWER" ${this.draft.role === 'VIEWER' ? 'selected' : ''}>Viewer</option><option value="CONTRIBUTOR" ${this.draft.role === 'CONTRIBUTOR' ? 'selected' : ''}>Contributor</option><option value="REVIEWER" ${this.draft.role === 'REVIEWER' ? 'selected' : ''}>Reviewer</option></select></div><div><label for="hours">Expires after</label><select id="hours" name="hours"><option value="24" ${this.draft.hours === 24 ? 'selected' : ''}>24 hours</option><option value="48" ${this.draft.hours === 48 ? 'selected' : ''}>48 hours</option><option value="72" ${this.draft.hours === 72 ? 'selected' : ''}>72 hours</option></select></div></div>
      <button class="primary" type="submit">Create invitation →</button></fieldset></form><p class="small">No automatic email. Codes are single-use and must be shared privately.</p>
      ${this.created ? `<div class="delivery"><h3>Code for ${esc(this.created.email)}</h3><label for="issued-code">Share this code privately</label><textarea id="issued-code" readonly spellcheck="false">${esc(this.created.code)}</textarea><div class="actions"><button data-action="copy">Copy code</button><button data-action="hide-code">Hide code</button></div></div>` : ''}</section>
      <section><div class="eyebrow">02 / ACCEPT AN INVITATION</div><h2>A clear invitation. Your choice.</h2><p>Your identity provider must verify the exact invited email. Possessing the code alone does not grant access.</p>
      ${p ? `<div class="preview"><h3>${esc(p.organizationName)}</h3><span class="badge">${esc(p.role)}</span><p>Expires ${esc(fmt(p.expiresAt))}</p><p>${p.alreadyMember ? 'You already have membership. Your existing role will not be changed.' : 'This adds organization membership only. Ask an administrator for project access.'}</p><div class="actions"><button data-action="cancel-preview" ${disabled ? 'disabled' : ''}>Cancel</button><button class="primary" data-action="accept" ${disabled ? 'disabled' : ''}>Accept invitation</button></div></div>` : `<form id="code-form"><fieldset ${disabled ? 'disabled' : ''}><label for="code">Invitation code</label><textarea id="code" name="code" maxlength="48" required spellcheck="false" autocomplete="off" placeholder="nvi1.…"></textarea><button type="submit" class="primary">Verify and review →</button></fieldset></form>`}
      <div class="trust"><strong>Membership is not project access.</strong><p>Invitations cannot assign owner/admin roles, restore suspended access, or approve a release.</p></div></section></div>
      <section><div class="list-head"><div><div class="eyebrow">INVITATION HISTORY</div><h2>Visibility without exposed codes.</h2></div>${this.client.orgId ? `<button data-action="refresh" ${disabled ? 'disabled' : ''}>Refresh</button>` : ''}</div>
      <div class="records">${this.client.rows.length ? this.client.rows.map(row => `<article><div><strong>${esc(row.email)}</strong><p>${esc(row.role)} · Expires ${esc(fmt(row.expiresAt))}</p></div><span class="badge">${esc(row.status)}</span>${row.status === 'pending' ? `<button data-action="revoke" data-id="${row.id}" ${disabled ? 'disabled' : ''}>Revoke</button>` : ''}</article>`).join('') : '<p>No invitation records on this page. Select an organization to view its history.</p>'}</div>
      ${this.client.next ? `<button data-action="next" ${disabled ? 'disabled' : ''}>Next page →</button>` : ''}</section>`}
      <footer>Design · Build · Test · Readiness <span>Explicit access. No automatic delivery.</span></footer>
      <dialog><form method="dialog"><h2>Revoke invitation?</h2><p></p><div class="actions"><button value="cancel">Cancel</button><button value="confirm">Revoke invitation</button></div></form></dialog></main>`;
  }
}
if (!customElements.get('navyix-invitations')) customElements.define('navyix-invitations', NavyixInvitations);
