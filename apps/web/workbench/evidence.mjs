import { BrowserWorkspace } from './client.mjs';
import { GitHubEvidenceClient } from './evidence-client.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class EvidenceWorkbench extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode:'open'}); this.phase='loading'; this.message=''; this.busy=false;
    this.api=new BrowserWorkspace({onSessionLost:()=>this.signedOut()}); this.evidence=new GitHubEvidenceClient(this.api);
    this.runId=''; this.attempt='1'; this.buildId=''; this.org=''; this.bound=false;
  }
  connectedCallback() {
    if(this.bound)return; this.bound=true; this.phase='loading';
    if(!this.listenersBound){this.listenersBound=true;
    this.shadowRoot.addEventListener('submit', e=>{e.preventDefault();void this.submit(e.target);});
    this.shadowRoot.addEventListener('change', e=>{void this.change(e.target);});
    this.shadowRoot.addEventListener('input', e=>{if(['runId','attempt'].includes(e.target.name)){this[e.target.name]=e.target.value;this.evidence.clear();this.updateResults();}});
    this.shadowRoot.addEventListener('click', e=>{if(e.target.closest('[data-export]'))this.export();});
    }
    if(typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('navyix-browser-session');this.channel.onmessage=e=>{if(e.data==='signed-out')this.signedOut();};}
    this.render();void this.start();
  }
  disconnectedCallback(){this.channel?.close();clearTimeout(this.expiry);this.evidence.clear();this.api.generation++;this.api.clear();this.bound=false;}
  signedOut(){this.evidence.clear();this.api.generation++;this.api.clear();clearTimeout(this.expiry);this.busy=false;this.phase='signedout';this.message='';this.render();}
  async start(){try{const yes=await this.api.init();if(!this.isConnected)return;if(!yes)return this.signedOut();this.phase='connected';this.expiry=setTimeout(()=>this.signedOut(),Math.max(0,Date.parse(this.api.expiresAt)-Date.now()));}catch(e){this.phase='error';this.message=e.message;}this.render();}
  async submit(form){
    if(this.busy)return;const data=Object.fromEntries(new FormData(form));this.evidence.clear();this.message='';this.busy=true;this.render();
    try{
      if(form.id==='organization'){this.org=data.org;await this.api.connect(data.org);this.buildId=this.api.project?.builds.at(-1)?.id||'';}
      else {this.runId=data.runId;this.attempt=data.attempt;this.buildId=data.buildId;await this.evidence.inspect(data);}
    }catch(e){if(e.code!=='STALE_CONTEXT'&&this.phase!=='signedout')this.message=e.message;}
    finally{this.busy=false;this.render();this.shadowRoot.querySelector(form.id==='inspect'?'#inspect button':'#organization button')?.focus({preventScroll:true});}
  }
  async change(element){
    this.evidence.clear();this.message='';
    if(element.name==='project'&&!this.busy){this.busy=true;this.render();try{await this.api.load(element.value);this.buildId=this.api.project?.builds.at(-1)?.id||'';}catch(e){if(this.phase!=='signedout')this.message=e.message;}this.busy=false;this.render();}
    else if(element.name==='buildId'){this.buildId=element.value;this.updateResults();}
  }
  export(){
    if(!this.evidence.value)return;
    const blob=new Blob([JSON.stringify(this.evidence.value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`navyix-run-${this.evidence.value.source.id}-attempt-${this.evidence.value.source.attempt}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  results(){
    const r=this.evidence.value;
    if(!r)return '<section class="empty"><span class="orbit" aria-hidden="true">◇</span><h2>Inspect what actually ran.</h2><p>Select a recorded build and an existing GitHub run. Navyix reads job metadata; it never starts a workflow here.</p><div class="path">SOURCE <span>→</span> BUILD <span>→</span> RUN <span>→</span> OBSERVATION</div></section>';
    return `<section class="observation" aria-label="Collected evidence"><div class="summary"><div><p class="eyebrow">GITHUB API OBSERVATION</p><h2>${esc(r.summary)}</h2><p>${esc(r.source.repository)} · Run ${r.source.id} · Attempt ${r.source.attempt}</p></div><span class="pill">Advisory · no readiness change</span></div>
      <div class="facts"><div><small>COMMIT</small><code>${esc(r.target.commitSha)}</code></div><div><small>COLLECTED</small><span>${esc(r.collectedAt)}</span></div><div><small>LOCAL TARGET</small><span>${esc(r.target.buildId)} / ${esc(r.target.environment)}</span></div></div>
      <h3>Required jobs</h3><div class="jobs">${r.criteria.map(c=>`<article><div><strong>${esc(c.name)}</strong><p>${esc(c.reason)}</p></div><span class="state ${c.state==='Reported success'?'success':'attention'}">${esc(c.state)}</span></article>`).join('')}</div>
      <aside class="limits"><strong>What this evidence does not prove</strong>${r.limitations.map(s=>`<p>${esc(s)}</p>`).join('')}</aside><div class="result-actions"><a href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">View selected run ↗</a><button data-export>Export observation JSON</button></div><p class="fine">Exported JSON is unsigned and editable. Its checksum is not a signature. It cannot satisfy release criteria by itself.</p></section>`;
  }
  updateResults(){const region=this.shadowRoot.querySelector('#results');if(region)region.innerHTML=this.results();}
  render(){
    const api=this.api, project=api.project;
    const content=this.phase==='loading'?'<section class="empty"><h2>Checking your session…</h2></section>':this.phase==='signedout'?'<section class="empty"><h2>Sign in to inspect project evidence.</h2><p>Your account’s organization and project permissions are checked on the server.</p><form method="post" action="/api/browser/login" data-login><button type="submit">Continue to sign in</button></form></section>':this.phase==='error'?`<section class="empty"><h2>Session unavailable</h2><p>${esc(this.message)}</p><a href="/workspace/evidence">Reload page</a></section>`:
    `<div class="layout"><aside class="controls"><p class="eyebrow">1 / SELECT CONTEXT</p><form id="organization"><label>Organization ID<input name="org" value="${esc(this.org)}" placeholder="Organization UUID" required ${this.busy?'disabled':''}></label><button ${this.busy?'disabled':''}>Connect organization</button></form>
      ${api.projects.length?`<label>Project<select name="project" aria-label="Project" ${this.busy?'disabled':''}>${api.projects.map(p=>`<option value="${esc(p.id)}" ${p.id===project?.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}
      <div class="divider"></div><p class="eyebrow">2 / INSPECT EXISTING RUN</p>${project?.builds.length?`<form id="inspect"><label>Recorded build<select name="buildId" aria-label="Recorded build" ${this.busy?'disabled':''}>${project.builds.map(b=>`<option value="${esc(b.id)}" ${b.id===this.buildId?'selected':''}>${esc(b.id)} · ${esc(b.label)}</option>`).join('')}</select></label><div class="two"><label>Run ID<input name="runId" value="${esc(this.runId)}" inputmode="numeric" pattern="[1-9][0-9]*" required ${this.busy?'disabled':''}></label><label>Attempt<input name="attempt" value="${esc(this.attempt)}" inputmode="numeric" pattern="[1-9][0-9]*" required ${this.busy?'disabled':''}></label></div><button class="primary" ${this.busy?'disabled':''}>${this.busy?'Collecting…':'Inspect GitHub evidence'}</button></form>`:'<p class="muted">Connect a project with a recorded build to continue.</p>'}<p class="fine">Repository and workflow approval are configured by your administrator. No repository token is entered or stored in this browser.</p></aside><div id="results" aria-live="polite">${this.results()}</div></div>`;
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="/workbench/evidence.css"><div class="shell"><header><a href="/workspace" class="brand"><span>N</span> NAVYIX</a><a class="back" href="/workspace">← Engineering workspace</a><span class="pill">READ-ONLY CONNECTOR</span></header><main><div class="hero"><p class="eyebrow">BUILD & TEST / SOURCE EVIDENCE</p><h1>Engineering claims.<br><em>Source-backed observations.</em></h1><p>Inspect the exact run, expose missing checks, and keep proof separate from assumptions.</p></div><div class="notice">GitHub job success is not test coverage or artifact verification. Your readiness assessments are unchanged by this inspector.</div>${this.message&&this.phase==='connected'?`<div role="alert" class="error">${esc(this.message)}</div>`:''}${content}</main><footer>No workflow dispatch · No source-code download · No automatic release approval</footer></div>`;
    // Native sign-in POST must reach the existing server session handler.
    this.shadowRoot.querySelector('[data-login]')?.addEventListener('submit',e=>e.stopPropagation());
  }
}
customElements.define('navyix-evidence-workbench',EvidenceWorkbench);
