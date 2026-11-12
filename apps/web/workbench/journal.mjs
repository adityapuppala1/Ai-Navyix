import { EvidenceJournalClient } from './journal-client.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString():'Unknown time';
class NavyixEvidenceHistory extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.api=new EvidenceJournalClient();this.busy=false;this.task=0;this.message='';this.error='';this.phase='loading';this.form={runId:'',attempt:'1',buildId:''};}
  connectedCallback(){
    if(this.attached)return;this.attached=true;
    this.click=e=>{const b=e.target.closest('[data-action]');if(b){e.preventDefault();this.action(b.dataset.action,b.dataset.id);}};
    this.submit=e=>{if(!e.target.dataset.form)return;e.preventDefault();if(e.target.dataset.form==='connect')this.action('connect');if(e.target.dataset.form==='capture')this.action('confirm');};
    this.input=e=>{if(['runId','attempt','buildId'].includes(e.target.name))this.form[e.target.name]=e.target.value;};
    this.shadowRoot.addEventListener('click',this.click);this.shadowRoot.addEventListener('submit',this.submit);this.shadowRoot.addEventListener('input',this.input);
    this.api.workspace.onSessionLost=()=>this.signedOut();
    if(typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('navyix-browser-session');this.channel.onmessage=e=>{if(e.data==='signed-out')this.signedOut();};}
    this.run(async()=>{this.phase=await this.api.workspace.init()?'ready':'signedout';if(this.phase==='ready')this.expiry=setTimeout(()=>this.signedOut(),Math.max(0,Date.parse(this.api.workspace.expiresAt)-Date.now()));});
  }
  disconnectedCallback(){this.task++;this.busy=false;this.phase='loading';this.attached=false;this.api.clear();this.api.workspace.generation++;this.api.workspace.clear();clearTimeout(this.expiry);this.channel?.close();this.shadowRoot.removeEventListener('click',this.click);this.shadowRoot.removeEventListener('submit',this.submit);this.shadowRoot.removeEventListener('input',this.input);}
  signedOut(){this.task++;this.api.clear();this.api.workspace.generation++;this.api.workspace.clear();clearTimeout(this.expiry);this.phase='signedout';this.busy=false;this.error='';this.message='';this.form={runId:'',attempt:'1',buildId:''};this.render();}
  async run(fn){if(this.busy)return;const task=++this.task;this.busy=true;this.error='';this.render();try{await fn();}catch(e){if(task===this.task&&e.code!=='STALE_CONTEXT')this.error=e.message||'The request could not be completed.';}finally{if(task===this.task){this.busy=false;if(this.attached)this.render();}}}
  async action(action,id){
    if(action==='close'){this.shadowRoot.querySelector('dialog')?.close();this.shadowRoot.querySelector('[data-action=confirm]')?.focus();return;}
    if(this.busy)return;
    if(action==='confirm'){
      const f=this.shadowRoot.querySelector('[data-form=capture]');if(!f?.reportValidity())return;
      const d=this.shadowRoot.querySelector('dialog');d.showModal();d.querySelector('[data-action=close]').focus();return;
    }
    const org=this.shadowRoot.querySelector('[name=org]')?.value,project=this.shadowRoot.querySelector('[name=project]')?.value;
    await this.run(async()=>{
      if(action==='connect'){await this.api.connect(org);this.form.buildId=this.api.workspace.project?.builds.at(-1)?.id||'';}
      if(action==='project'){await this.api.project(project);this.form.buildId=this.api.workspace.project?.builds.at(-1)?.id||'';}
      if(action==='history')await this.api.history();
      if(action==='more')await this.api.history(true);
      if(action==='open')await this.api.open(id);
      if(action==='capture'){await this.api.capture({...this.form});this.message='Observation saved. Readiness is unchanged.';}
      if(action==='retry'){await this.api.retry();this.message='Original capture confirmed. Readiness is unchanged.';}
      if(action==='logout'){await this.api.workspace.logout();this.channel?.postMessage('signed-out');this.signedOut();}
      if(action==='export'&&this.api.selected){const blob=new Blob([JSON.stringify({exportNotice:'Unsigned editable copy. Not a release approval.',...this.api.selected},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`navyix-observation-${this.api.selected.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    });
    if(action==='open')this.shadowRoot.querySelector('#detail-heading')?.focus();
  }
  render(){
    const w=this.api.workspace,p=w.project,s=this.api.selected,blocked=this.busy||!!this.api.pending,disabled=blocked?'disabled':'';
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="/workbench/journal.css"><div class="shell">
      <header><a class="brand" href="/workspace"><span>N</span>NAVYIX</a><span class="header-tag">ENGINEERING EVIDENCE</span><a href="/workspace">Back to workspace ↗</a>${this.phase==='ready'?'<button data-action="logout">Sign out</button>':''}</header>
      <main><div class="eyebrow">DESIGN / BUILD / TEST / READINESS</div><h1>Evidence, with a memory.</h1><p class="intro">A recorded history of what GitHub reported, for the exact build you selected.</p>
      <div class="notice"><b>Observation ≠ approval.</b> Saved job metadata does not verify the artifact or test coverage. No readiness decision is changed.</div>
      ${this.phase==='loading'?'<p role="status">Checking your session…</p>':this.phase==='signedout'?'<section class="panel"><h2>Sign in to view your project history</h2><p>Evidence stays behind your organization and project permissions.</p><form method="post" action="/api/browser/login"><button class="primary">Sign in securely ↗</button></form></section>':`
      <form class="connect panel" data-form="connect"><label>Organization ID<input name="org" required value="${esc(w.orgId||'')}" placeholder="Organization UUID" ${disabled}></label><button ${disabled}>Connect organization</button></form>
      ${w.projects.length?`<div class="project-row"><label>Project<select name="project" ${disabled}>${w.projects.map(x=>`<option value="${esc(x.id)}" ${p?.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><button type="button" data-action="project" ${disabled}>Open project</button><span class="muted">${p?'Current revision '+p.revision:''}</span></div>`:''}
      ${p?`<div class="grid"><section class="panel"><div class="section-title"><span class="step">01</span><div><h2>Capture an observation</h2><p>Explicit collection. No automatic polling or workflow runs.</p></div></div>
      <form data-form="capture"><label>Recorded build<select name="buildId" required ${disabled}><option value="">Select a build</option>${p.builds.map(b=>`<option value="${esc(b.id)}" ${this.form.buildId===b.id?'selected':''}>${esc(b.label||b.id)} · ${esc(b.environment)}</option>`).join('')}</select></label>
      <div class="fields"><label>GitHub run ID<input name="runId" inputmode="numeric" pattern="[1-9][0-9]{0,15}" required value="${esc(this.form.runId)}" placeholder="Existing run ID" ${disabled}></label><label>Attempt<input name="attempt" inputmode="numeric" pattern="[1-9][0-9]{0,3}" required value="${esc(this.form.attempt)}" ${disabled}></label></div>
      <p class="muted">The server collects fresh metadata from the approved connection. Browser-uploaded observations are not accepted.</p><button class="primary" type="submit" data-action="confirm" ${disabled||(!p.builds.length?'disabled':'')}>Review capture →</button></form>
      ${this.api.pending?'<div class="retry"><b>Capture not yet confirmed.</b><p>Retry reuses the original request. Do not create another capture.</p><button data-action="retry" '+(this.busy?'disabled':'')+'>Retry original capture</button></div>':''}
      </section><section class="panel"><div class="section-title"><span class="step">02</span><div><h2>Saved observations</h2><p>Newest first · ${this.api.rows.length} loaded</p></div><button data-action="history" ${disabled}>Refresh</button></div>
      ${this.api.rows.length?`<div class="records">${this.api.rows.map(r=>`<button class="record" data-action="open" data-id="${esc(r.id)}" ${disabled}><span><b>${esc(r.source.repository)}</b><small>Run ${esc(r.source.id)} / attempt ${esc(r.source.attempt)} · ${esc(r.target.buildId)}</small><small>${esc(when(r.recordedAt))} · revision ${r.projectRevision}</small></span><span class="badge">${esc(r.summary)}</span></button>`).join('')}</div>`:'<div class="empty"><span>◇</span><h3>No saved observations</h3><p>Capture an existing run to start a reviewable history.</p></div>'}
      ${this.api.next?`<button data-action="more" ${disabled}>Load older observations</button>`:''}</section></div>
      ${s?`<section class="panel detail"><div class="section-title"><span class="step">03</span><div><h2 id="detail-heading" tabindex="-1">Saved evidence detail</h2><p>${s.matchesCurrentRevision?'Matches current project revision':'Historical observation — project has changed since collection'}</p></div><button data-action="export" ${disabled}>Export JSON</button></div>
      <dl><div><dt>Build</dt><dd>${esc(s.observation.target.buildId)}</dd></div><div><dt>Recorded revision</dt><dd>${s.projectRevision}</dd></div><div><dt>Readiness effect</dt><dd>None</dd></div><div><dt>Captured at</dt><dd>${esc(when(s.recordedAt))}</dd></div></dl><p class="muted">The canonical checksum detects content mismatches. It is not a signature, attestation, or release approval.</p><details><summary>Inspect the saved record</summary><pre>${esc(JSON.stringify(s.observation,null,2))}</pre></details></section>`:''}`:w.orgId?'<div class="empty">No accessible projects. Create a project in the main workspace.</div>':''}`}
      <p class="feedback" role="status" aria-live="polite">${esc(this.busy?'Working…':this.message)}</p>${this.error?`<p class="error" role="alert">${esc(this.error)}</p>`:''}
      <footer>Readiness remains evidence-based. Capture is a record, not a pass.</footer>
      <dialog aria-labelledby="confirm-title"><h2 id="confirm-title">Capture this existing run?</h2><p>${esc(p?.name)} · revision ${p?.revision||''}</p><p>Build <b>${esc(this.form.buildId)}</b> · run <b>${esc(this.form.runId)}</b> · attempt <b>${esc(this.form.attempt)}</b></p><p>No workflow is started. The saved record will not change readiness.</p><div class="dialog-actions"><button data-action="close">Cancel</button><button class="primary" data-action="capture">Collect and save</button></div></dialog>
      </main></div>`;
  }
}
if(!customElements.get('navyix-evidence-history'))customElements.define('navyix-evidence-history',NavyixEvidenceHistory);
