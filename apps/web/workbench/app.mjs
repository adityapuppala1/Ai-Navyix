import { createProject, applyCommand, assessProject, reportTemplate, MAX_REPORT_BYTES } from './workflow.mjs';
import { STORAGE_KEY, readWorkspace, saveWorkspace, emptyWorkspace } from './storage.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = value => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const tone = status => ({ Ready: 'good', Met: 'good', passed: 'good', succeeded: 'good', Blocked: 'bad', Unmet: 'bad', failed: 'bad', error: 'bad', Stale: 'warn', skipped: 'warn', Reviewed: 'good' }[status] || 'neutral');
const pill = status => `<span class="pill ${tone(status)}">${e(status)}</span>`;
const stageLabel = { design: 'Ready for design', build: 'Ready to build', test: 'Ready to test', release: 'Ready for release' };
const views = [['overview', 'Overview', '◈'], ['requirements', 'Requirements', '≡'], ['design', 'Design records', '◇'], ['builds', 'Builds', '⌘'], ['tests', 'Tests & results', '✓'], ['readiness', 'Readiness', '◎'], ['history', 'Assessment history', '↺']];
const button = (action, label, extra = '', primary = false) => `<button type="button" class="btn ${primary ? 'primary' : ''}" data-action="${action}" ${extra}>${label}</button>`;
const empty = (title, description, action, label) => `<div class="empty"><div class="empty-icon">◇</div><h3>${e(title)}</h3><p>${e(description)}</p>${action ? button(action, e(label), '', true) : ''}</div>`;
const field = (label, name, value = '', type = 'text', hint = '') => `<label class="field">${label}<input name="${name}" type="${type}" value="${e(value)}" required maxlength="${name === 'goal' ? 4000 : 200}" ${type === 'text' ? 'autocomplete="off"' : ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
const area = (label, name, value = '', hint = '') => `<label class="field">${label}<textarea name="${name}" rows="4" required maxlength="8000">${e(value)}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
const option = (id, label, selected) => `<option value="${e(id)}" ${id === selected ? 'selected' : ''}>${e(label)}</option>`;

class NavyixWorkbench extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this.tab = 'overview'; this.stage = 'release'; this.projectId = null; this.buildId = null; this.message = ''; this.error = ''; this.theme = 'dark'; }
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${new URL('./workbench.css', import.meta.url).href}"><div class="root"></div>`;
    this.root = this.shadowRoot.querySelector('.root');
    this.clickHandler = event => this.onClick(event);
    this.changeHandler = event => this.onChange(event);
    this.shadowRoot.addEventListener('click', this.clickHandler);
    this.shadowRoot.addEventListener('change', this.changeHandler);
    this.storageHandler = event => { if (event.key === STORAGE_KEY) { this.error = 'Workspace changed in another tab. Reload local data before editing.'; this.renderAlert(); } };
    window.addEventListener('storage', this.storageHandler);
    this.load();
  }
  disconnectedCallback() { window.removeEventListener('storage', this.storageHandler); this.shadowRoot.removeEventListener('click', this.clickHandler); this.shadowRoot.removeEventListener('change', this.changeHandler); this.started = false; }
  load() {
    try { this.workspace = readWorkspace(this.store); this.loadError = false; this.error = ''; this.projectId = this.workspace.projects.some(p => p.id === this.projectId) ? this.projectId : this.workspace.projects[0]?.id; }
    catch (error) { this.workspace = emptyWorkspace(); this.loadError = true; this.error = error.message; }
    this.render();
  }
  get store() { return this.storage || localStorage; }
  get project() { return this.workspace.projects.find(p => p.id === this.projectId); }
  get targetBuild() { return this.buildId === null ? this.project?.builds.at(-1) : this.project?.builds.find(b => b.id === this.buildId); }
  assessment(stage = this.stage) { return assessProject(this.project, { stage, buildId: this.targetBuild?.id, environment: this.project.environment }); }
  async mutate(fn, message) {
    const write = () => { const next = fn(structuredClone(this.workspace)); this.workspace = saveWorkspace(this.store, next, this.workspace.revision); };
    try {
      if (navigator.locks?.request) await navigator.locks.request(STORAGE_KEY, write); else write();
      this.error = ''; this.message = message; return true;
    } catch (error) { this.error = error.message; this.renderAlert(); return false; }
  }
  async command(type, input, message) {
    return this.mutate(workspace => { const index = workspace.projects.findIndex(p => p.id === this.projectId); if (index < 0) throw new Error('Select a project.'); workspace.projects[index] = applyCommand(workspace.projects[index], { type, input }); return workspace; }, message);
  }
  download(value, name) {
    const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  renderAlert() { const region = this.root.querySelector('#alerts'); if (region) region.innerHTML = this.error ? `<div class="alert error" role="alert">${e(this.error)} ${button('reload', 'Reload local data')}</div>` : this.message ? `<div class="alert success" role="status">${e(this.message)}</div>` : ''; }
  render() {
    const p = this.project;
    this.root.dataset.theme = this.theme;
    this.root.innerHTML = `<a class="skip" href="#content">Skip to main content</a><div class="shell">
      <aside class="sidebar"><a class="brand" href="/" aria-label="Navyix home"><span class="brand-mark">N</span>NAVYIX<span class="brand-dot"></span></a>
        <div class="workspace-label">ENGINEERING WORKSPACE</div><div class="local-card"><span class="local-dot"></span><div>Local workbench<small>No customer data connections</small></div></div>
        <nav aria-label="Project navigation">${views.map(([key, label, glyph]) => `<button type="button" class="nav-item ${key === this.tab ? 'active' : ''}" data-action="nav" data-view="${key}" ${key === this.tab ? 'aria-current="page"' : ''}><span aria-hidden="true">${glyph}</span>${label}${key === 'requirements' && p ? `<small>${p.requirements.length}</small>` : ''}</button>`).join('')}</nav>
        <div class="side-bottom"><div class="ai-card"><span>✧</span><strong>AI, with boundaries.</strong><p>No model is connected. Your content is not sent to an AI provider.</p></div><div class="side-note">Design. Build. Test.<br><b>Know what is ready.</b></div></div>
      </aside><div class="main-shell"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> <b>${e(p?.name || 'Get started')}</b></div><div class="top-actions">${pill('Local · advisory')}${button('theme', this.theme === 'dark' ? 'Light theme' : 'Dark theme')}</div></header>
      <main id="content" tabindex="-1"><div id="alerts"></div>
        <div class="context-bar"><label class="project-select">PROJECT<select id="project-select" aria-label="Active project"><option value="">Select a project</option>${this.workspace.projects.map(x => option(x.id, x.name, this.projectId)).join('')}</select></label>${button('project', '+ New project')}${p ? button('export-project', 'Export project ↗') : ''}</div>
        <div class="boundary"><span aria-hidden="true">◉</span><p>${p?.sample ? '<b>Sample project: synthetic evidence.</b> ' : '<b>Local preview.</b> '}Saved only in this browser. No authentication, tenant isolation, CI execution or production approval. Use non-sensitive data.</p></div>
        ${this.loadError ? empty('Your stored data needs attention', this.error, 'raw-export', 'Export raw data') + button('reset', 'Reset local workspace') : p ? this.renderView() : this.welcome()}
      </main><footer>NAVYIX <span>Evidence before confidence.</span><span>Local workbench v0.2 · ${this.workspace.projects.length} project(s)</span></footer></div></div><dialog aria-labelledby="dialog-title"><div class="dialog-body"></div></dialog>`;
    this.renderAlert();
  }
  heading(eyebrow, title, description, action = '') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
  welcome() {
    return `<section class="welcome"><div class="orb" aria-hidden="true"><span></span><i></i><b>N</b></div><div class="eyebrow">YOUR DELIVERY STORY STARTS HERE</div><h1>From intent<br>to <em>evidence.</em></h1><p>Create a project, connect design decisions to requirements, record a build, and evaluate what the tests actually prove.</p><div class="welcome-actions">${button('project', 'Create your first project →', '', true)}${button('sample', 'Explore sample workflow')}</div><div class="welcome-steps"><span>01 <b>Design</b></span><span>02 <b>Build</b></span><span>03 <b>Test</b></span><span>04 <b>Readiness</b></span></div></section>`;
  }
  renderView() {
    const p = this.project;
    if (this.tab === 'overview') {
      const a = this.assessment();
      return this.heading('PROJECT / OVERVIEW', 'See the whole delivery story.', e(p.goal)) +
        `<section class="metrics" aria-label="Project totals">${[['Requirements', p.requirements.length, 'Versioned intent'], ['Design decisions', p.designs.length, 'Linked reasoning'], ['Build records', p.builds.length, 'Exact artifact identity'], ['Test definitions', p.testCases.length, `${p.reports.length} imported execution(s)`]].map(([label, count, note]) => `<article class="metric"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join('')}</section>
        <section class="panel"><div class="panel-head"><div><h2>Your readiness pathway</h2><p>Separate decisions. Shared evidence. No averaged readiness score.</p></div><span class="tag">${e(p.environment)}</span></div><div class="stage-grid">${Object.entries(stageLabel).map(([key, label], i) => { const x = this.assessment(key); return `<button class="stage-card" data-action="stage" data-stage="${key}"><span class="step">0${i + 1}</span><h3>${label}</h3>${pill(x.status)}<small>${x.met} of ${x.total} criteria met <span>↗</span></small></button>`; }).join('')}</div></section>
        <div class="two-col"><section class="panel"><div class="panel-head"><div><h2>What needs attention</h2><p>Owner and next action for the current target.</p></div></div>${a.criteria.filter(c => c.status !== 'Met').slice(0, 4).map(c => `<button class="blocker" data-action="criterion" data-key="${e(c.key)}"><span class="signal ${tone(c.status)}"></span><div><strong>${e(c.title)}</strong><p>${e(c.reason)}</p><small>${e(c.owner)}</small></div><span aria-hidden="true">↗</span></button>`).join('') || `<div class="all-clear">All starter criteria are met.<p>This is a local advisory result, not authorization to deploy.</p></div>`}</section>
        <section class="panel"><div class="panel-head"><div><h2>Recent activity</h2><p>Changes you have made in this browser.</p></div></div><div class="activity">${p.activity.slice(0, 5).map(x => `<article><span class="activity-dot"></span><div><p>${e(x.detail)}</p><small>${e(when(x.at))}</small></div></article>`).join('') || '<p class="muted">Add your first requirement to begin.</p>'}</div></section></div>`;
    }
    if (this.tab === 'requirements') return this.heading('01 / REQUIREMENTS', 'Make the intent explicit.', 'Define measurable acceptance criteria. Revisions invalidate dependent evidence.', button('requirement', '+ Add requirement', '', true)) +
      (p.requirements.length ? `<div class="record-grid">${p.requirements.map(r => `<article class="record"><div class="record-top"><span class="record-id">${e(r.id)} · v${r.revision}</span>${pill(r.reviewedRevision === r.revision ? 'Reviewed' : 'Draft')}</div><h2>${e(r.title)}</h2><div class="record-section"><span>ACCEPTANCE CRITERIA</span><p class="pre">${e(r.acceptance)}</p></div><div class="record-footer"><span>Owner · ${e(r.owner)}</span><div>${button('requirement', 'Edit', `data-id="${e(r.id)}"`)}${r.reviewedRevision !== r.revision ? button('review-requirement', 'Mark reviewed', `data-id="${e(r.id)}"`) : ''}</div></div></article>`).join('')}</div>` : empty('Start with one clear requirement', 'Describe the behavior and how the team will know it works.', 'requirement', '+ Add requirement'));
    if (this.tab === 'design') return this.heading('02 / DESIGN', 'Connect decisions to intent.', 'Record architecture, interfaces and tradeoffs against requirement versions.', button('design', '+ Add design', '', true)) +
      (p.designs.length ? `<div class="record-grid">${p.designs.map(d => { const stale = d.requirements.some(ref => p.requirements.find(r => r.id === ref.id)?.revision !== ref.revision); return `<article class="record"><div class="record-top"><span class="record-id">${e(d.id)}</span>${pill(stale ? 'Stale' : d.reviewedAt ? 'Reviewed' : 'Draft')}</div><h2>${e(d.title)}</h2><p class="pre">${e(d.decision)}</p><div class="chips">${d.requirements.map(r => `<span class="tag">${e(r.id)} · v${r.revision}</span>`).join('')}</div><div class="record-footer"><span>Owner · ${e(d.owner)}</span>${!d.reviewedAt && !stale ? button('review-design', 'Mark reviewed', `data-id="${e(d.id)}"`) : '<span class="muted">Revision-specific record</span>'}</div></article>`; }).join('')}</div>` : empty('Capture why the system is designed this way', 'Link a design decision to at least one requirement.', 'design', '+ Add design'));
    if (this.tab === 'builds') return this.heading('03 / BUILD', 'Identify what was built.', 'Record a complete source revision, artifact digest and target environment. Navyix does not compile code here.', button('build', '+ Record build', '', true)) +
      (p.builds.length ? `<section class="panel"><div class="table-wrap"><table><caption class="sr-only">Recorded builds</caption><thead><tr><th>Build</th><th>Identity</th><th>Environment</th><th>Outcome</th><th>Recorded scope</th></tr></thead><tbody>${[...p.builds].reverse().map(b => `<tr><td><strong>${e(b.label)}</strong><small>${e(b.id)} · ${e(when(b.builtAt))}</small></td><td><code title="${e(b.commitSha)}">${e(b.commitSha.slice(0, 12))}…</code><small><code title="${e(b.artifactDigest)}">${e(b.artifactDigest.slice(0, 20))}…</code></small></td><td>${e(b.environment)}</td><td>${pill(b.status)}</td><td>Requirements v${b.requirementsVersion}<small>Design v${b.designVersion} · manual record</small></td></tr>`).join('')}</tbody></table></div></section>` : empty('Record an identifiable build', 'Keep the full commit SHA and artifact digest. Labels alone are not sufficient evidence.', 'build', '+ Record build'));
    if (this.tab === 'tests') return this.heading('04 / TEST', 'Distinguish a plan from a result.', 'Define test steps, then import observed results for an exact build. All tests are mandatory in the starter policy.', button('test', '+ Add test case', '', true)) +
      `<section class="panel import-panel"><div><h2>Bring execution evidence into the story.</h2><p>Upload a JSON report or paste it. Imports are validated atomically; old runs are retained.</p></div><div>${button('template', 'Download report template')}${button('import', 'Import test results', '', true)}</div></section>` +
      (p.testCases.length ? `<div class="record-grid">${p.testCases.map(t => `<article class="record"><div class="record-top"><span class="record-id">${e(t.id)} · v${t.revision}</span><span class="tag">${e(t.requirementId)} · v${t.requirementRevision}</span></div><h2>${e(t.title)}</h2><div class="record-section"><span>STEPS</span><p class="pre">${e(t.steps)}</p><span>EXPECTED OUTCOME</span><p class="pre">${e(t.expected)}</p></div><div class="record-footer"><span>Owner · ${e(t.owner)}</span>${button('test', 'Edit test', `data-id="${e(t.id)}"`)}</div></article>`).join('')}</div>` : empty('Define what needs to be verified', 'A test definition is planned work, not a successful execution.', 'test', '+ Add test case')) +
      `<section class="panel runs"><div class="panel-head"><div><h2>Imported execution history</h2><p>User-supplied evidence · not independently verified</p></div><span class="tag">${p.reports.length} runs</span></div>${p.reports.length ? [...p.reports].reverse().map(r => `<details class="run"><summary><strong>${e(r.runId)}</strong><span>${e(r.buildId)} · ${e(r.environment)} · ${r.results.length} results</span><small>${e(when(r.executedAt))}</small></summary><div class="run-results">${r.results.map(x => `<div><span>${e(x.testCaseId)} · v${x.testCaseRevision}</span>${pill(x.status)}<span>${e(x.note)}</span></div>`).join('')}</div></details>`).join('') : '<p class="panel-empty">No execution evidence imported yet.</p>'}</section>`;
    if (this.tab === 'readiness') {
      const a = this.assessment();
      return this.heading('05 / READINESS', 'A decision you can inspect.', 'Mandatory failures block readiness. Missing and outdated evidence remain visible.', button('save-assessment', 'Save assessment', '', true)) +
        `<div class="target-controls"><label>ACTIVITY<select id="stage-select" aria-label="Readiness activity">${Object.entries(stageLabel).map(([key, label]) => option(key, label, this.stage)).join('')}</select></label><label>TARGET BUILD<select id="build-select" aria-label="Target build"><option value="">No build selected</option>${p.builds.map(b => option(b.id, `${b.id} · ${b.label} · ${b.environment}`, this.targetBuild?.id)).join('')}</select></label><div><span>ENVIRONMENT</span><strong>${e(p.environment)}</strong></div></div>
        <section class="decision-banner ${tone(a.status)}"><div><div class="eyebrow">LIVE LOCAL EVALUATION</div><h2>${e(a.status)}</h2><p>${a.met} of ${a.total} criteria met · ${e(a.policyVersion)}</p></div><div class="decision-note">${e(a.artifactDigest ? a.artifactDigest.slice(0, 23) + '…' : 'No artifact selected')}<small>Advisory only · unverified provenance</small></div></section>
        <section class="panel"><div class="panel-head"><div><h2>Criteria & evidence</h2><p>Open any criterion to inspect the supporting records and next action.</p></div><span class="tag">${e(stageLabel[this.stage])}</span></div><div class="criteria">${a.criteria.map(c => `<button class="criterion" data-action="criterion" data-key="${e(c.key)}"><div><strong>${e(c.title)}</strong><p>${e(c.reason)}</p><small>Owner · ${e(c.owner)}</small></div>${pill(c.status)}<span aria-hidden="true">↗</span></button>`).join('')}</div></section>`;
    }
    return this.heading('06 / HISTORY', 'Keep the decision, not just the badge.', 'Saved assessments retain their original target, policy and evidence. Later edits do not rewrite history.') +
      (p.assessments.length ? `<div class="record-grid">${[...p.assessments].reverse().map(a => `<article class="record"><div class="record-top"><span class="record-id">${e(a.id)}</span>${pill(a.status)}</div><h2>${e(stageLabel[a.stage])}</h2><p>${e(a.buildId || 'No build')} · ${e(a.environment)}</p><p>${a.met} / ${a.total} criteria met · ${e(a.policyVersion)}</p><small>Saved ${e(when(a.evaluatedAt))} · project revision ${a.projectRevision}</small><div class="record-footer"><span class="muted">Historical snapshot; not a live approval</span>${button('export-assessment', 'Export snapshot ↗', `data-id="${e(a.id)}"`)}</div></article>`).join('')}</div>` : empty('No assessment saved yet', 'Evaluate readiness, then save a version-specific snapshot.', 'show-readiness', 'Evaluate readiness'));
  }
  async onClick(event) {
    const el = event.target.closest('[data-action]'); if (!el) return;
    const action = el.dataset.action, p = this.project;
    try {
      if (action === 'nav') { this.tab = el.dataset.view; this.message = ''; this.render(); this.root.querySelector('#content').focus(); return; }
      if (action === 'theme') { this.theme = this.theme === 'dark' ? 'light' : 'dark'; this.render(); return; }
      if (action === 'reload') { this.load(); return; }
      if (action === 'project') { this.openForm('project'); return; }
      if (action === 'sample') { await this.addSample(); return; }
      if (action === 'raw-export') { this.download(this.store.getItem(STORAGE_KEY) || '{}', 'navyix-raw-recovery.json'); return; }
      if (action === 'reset') { if (confirm('Delete this browser’s entire local Navyix workspace? Export your data first.')) { this.store.removeItem(STORAGE_KEY); this.load(); } return; }
      if (action === 'close-dialog') { this.shadowRoot.querySelector('dialog').close(); return; }
      if (!p) throw new Error('Create or select a project first.');
      if (action === 'export-project') { this.download(p, 'navyix-project.json'); return; }
      if (action === 'export-assessment') { this.download(p.assessments.find(a => a.id === el.dataset.id), `navyix-${el.dataset.id}.json`); return; }
      if (action === 'show-readiness' || action === 'stage') { this.tab = 'readiness'; this.stage = el.dataset.stage || 'release'; this.render(); return; }
      if (['requirement', 'design', 'build', 'test', 'import'].includes(action)) { this.openForm(action, el.dataset.id); return; }
      if (action === 'review-requirement') { const r = p.requirements.find(x => x.id === el.dataset.id); if (await this.command('requirement.review', { id: r.id, expectedRevision: r.revision }, 'Local review recorded. This is not an authenticated approval.')) this.render(); return; }
      if (action === 'review-design') { if (await this.command('design.review', { id: el.dataset.id }, 'Local design review recorded.')) this.render(); return; }
      if (action === 'save-assessment') { if (await this.command('assessment.create', { stage: this.stage, buildId: this.targetBuild?.id, environment: p.environment }, 'Assessment snapshot saved. Open Assessment history to export it.')) this.render(); return; }
      if (action === 'template') { if (!this.targetBuild || !p.testCases.length) throw new Error('Record a build and define a test case before downloading a report template.'); this.download(reportTemplate(p, this.targetBuild.id), 'navyix-test-report-template.json'); return; }
      if (action === 'criterion') {
        const a = this.assessment(this.tab === 'overview' ? 'release' : this.stage), c = a.criteria.find(x => x.key === el.dataset.key);
        const dialog = this.shadowRoot.querySelector('dialog');
        dialog.querySelector('.dialog-body').innerHTML = `<div class="dialog-head"><div><div class="eyebrow">EVIDENCE INSPECTOR</div><h2 id="dialog-title">${e(c.title)}</h2></div>${button('close-dialog', 'Close')}</div>${pill(c.status)}<p>${e(c.reason)}</p><div class="next-action"><strong>Next action</strong><p>${e(c.action)}</p><small>Owner · ${e(c.owner)}</small></div><h3>Captured evidence</h3><p class="muted">Local user-supplied records, not independently verified. No AI-generated claims.</p><pre class="evidence-json">${e(JSON.stringify(c.evidence, null, 2))}</pre>`;
        dialog.showModal(); return;
      }
    } catch (error) { this.error = error.message; this.renderAlert(); }
  }
  onChange(event) {
    if (event.target.id === 'project-select') { this.projectId = event.target.value || null; this.buildId = null; this.message = ''; this.render(); }
    if (event.target.id === 'stage-select') { this.stage = event.target.value; this.render(); }
    if (event.target.id === 'build-select') { this.buildId = event.target.value; this.render(); }
  }
  openForm(type, recordId) {
    const p = this.project, dialog = this.shadowRoot.querySelector('dialog');
    let title = '', fields = '', record;
    if (type === 'project') { title = 'Create a project'; fields = field('Project name', 'name') + area('Project goal', 'goal') + '<div class="form-grid">' + field('Owner', 'owner') + field('Environment', 'environment', 'staging') + '</div>'; }
    if (type === 'requirement') { record = p.requirements.find(r => r.id === recordId); title = record ? 'Revise requirement' : 'Add requirement'; fields = field('Requirement title', 'title', record?.title) + area('Acceptance criteria', 'acceptance', record?.acceptance, 'Describe observable behavior and measurable outcomes.') + field('Owner', 'owner', record?.owner || p.owner); }
    if (type === 'design') {
      if (!p.requirements.length) throw new Error('Add a requirement before creating a linked design.');
      title = 'Add design record'; fields = field('Design title', 'title') + area('Decision and tradeoffs', 'decision') + field('Owner', 'owner', p.owner) + `<fieldset><legend>Linked requirements</legend>${p.requirements.map(r => `<label class="check"><input type="checkbox" name="requirementIds" value="${e(r.id)}">${e(r.id)} · v${r.revision} · ${e(r.title)}</label>`).join('')}</fieldset>`;
    }
    if (type === 'build') { title = 'Record a build'; fields = '<p class="form-note">Record an existing build. This form does not compile, deploy or independently verify code.</p>' + field('Build label', 'label') + field('Commit SHA', 'commitSha', '', 'text', 'Full 40- or 64-character hexadecimal source revision.') + field('Artifact digest', 'artifactDigest', '', 'text', 'sha256: followed by 64 hexadecimal characters.') + field('Environment', 'environment', p.environment) + '<label class="field">Build outcome<select name="status"><option value="succeeded">Succeeded</option><option value="failed">Failed</option></select></label>'; }
    if (type === 'test') {
      if (!p.requirements.length) throw new Error('Add a requirement before defining a test case.');
      record = p.testCases.find(t => t.id === recordId); title = record ? 'Revise test case' : 'Add test case';
      fields = field('Test title', 'title', record?.title) + `<label class="field">Requirement<select name="requirementId">${p.requirements.map(r => option(r.id, `${r.id} · v${r.revision} · ${r.title}`, record?.requirementId)).join('')}</select></label>` + area('Test steps', 'steps', record?.steps) + area('Expected outcome', 'expected', record?.expected) + field('Owner', 'owner', record?.owner || p.owner);
    }
    if (type === 'import') {
      if (!this.targetBuild || !p.testCases.length) throw new Error('Record a build and define test cases before importing results.');
      title = 'Import execution results'; fields = '<p class="form-note">Use a report from an actual test run. Match build ID, artifact digest, environment and test revisions. Template outcomes are skipped until replaced.</p><label class="field">Choose JSON report<input id="report-file" type="file" accept=".json,application/json"><small>Maximum 1 MB. File contents stay in your browser.</small></label><label class="field">Report JSON<textarea name="report" rows="12" required spellcheck="false" maxlength="1000000" placeholder="Paste your completed report JSON here"></textarea></label>';
    }
    dialog.querySelector('.dialog-body').innerHTML = `<div class="dialog-head"><div><div class="eyebrow">LOCAL WORKFLOW</div><h2 id="dialog-title">${title}</h2></div>${button('close-dialog', 'Cancel')}</div><form><div class="form-error" role="alert"></div>${fields}<div class="form-actions"><span>Saved in this browser only.</span><button class="btn primary" type="submit">${type === 'import' ? 'Validate & import' : 'Save ' + (type === 'project' ? 'project' : 'record')}</button></div></form>`;
    const form = dialog.querySelector('form');
    const fileInput = form.querySelector('#report-file');
    if (fileInput) fileInput.addEventListener('change', async () => { try { const file = fileInput.files[0]; if (!file) return; if (file.size > MAX_REPORT_BYTES) throw new Error('Report exceeds the 1 MB limit.'); form.elements.report.value = await file.text(); } catch (error) { form.querySelector('.form-error').textContent = error.message; } });
    form.addEventListener('submit', async event => {
      event.preventDefault(); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        const data = new FormData(form), input = Object.fromEntries(data.entries()); let ok;
        if (type === 'project') {
          const project = createProject(input); ok = await this.mutate(w => { w.projects.push(project); return w; }, 'Project created. Start with a requirement.');
          if (ok) { this.projectId = project.id; this.buildId = null; this.tab = 'requirements'; }
        } else {
          if (type === 'design') input.requirementIds = data.getAll('requirementIds');
          if (record) { input.id = record.id; input.expectedRevision = record.revision; }
          const operation = type === 'import' ? 'results.import' : `${type}.${record ? 'update' : 'add'}`;
          ok = await this.command(operation, input, type === 'import' ? 'Test report imported. Evaluate readiness to inspect the result.' : 'Record saved. Readiness now reflects the change.');
          if (ok && type === 'build') this.buildId = this.project.builds.at(-1).id;
        }
        if (!ok) throw new Error(this.error);
        dialog.close(); this.render(); this.root.querySelector('#content').focus();
      } catch (error) { form.querySelector('.form-error').textContent = error.message; submit.disabled = false; }
    });
    dialog.showModal();
  }
  async addSample() {
    const now = Date.now() - 60_000;
    let p = createProject({ name: 'Sample · Customer Portal', goal: 'Let customers sign in securely with a one-time code. Follow the requirement all the way to its release evidence.', owner: 'Sample team', environment: 'staging' }, now);
    const run = (type, input) => { p = applyCommand(p, { type, input }, now + 1000); };
    run('requirement.add', { title: 'One-time code sign-in', acceptance: 'A valid code signs the user in once. Reuse of the same code is rejected.', owner: 'Sample identity team' });
    run('requirement.review', { id: 'REQ-001', expectedRevision: 1 });
    run('design.add', { title: 'Single-use authentication flow', decision: 'Hash the code at rest and consume it atomically. Expire unused codes after five minutes. Return generic errors to avoid account discovery.', requirementIds: ['REQ-001'] });
    run('design.review', { id: 'DSN-001' });
    run('build.add', { label: 'Sample candidate 0.4', commitSha: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}`, status: 'succeeded' });
    run('test.add', { title: 'Accept a valid code', requirementId: 'REQ-001', steps: 'Request a code. Submit it before expiry.', expected: 'A session is created.' });
    run('test.add', { title: 'Reject code reuse', requirementId: 'REQ-001', steps: 'Submit a valid code, then submit it a second time.', expected: 'The second attempt is rejected.' });
    const report = reportTemplate(p, 'BLD-001', now + 2000); report.runId = 'sample-run-1'; report.results[0].status = 'passed'; report.results[1].status = 'failed'; report.results.forEach(r => { r.note = 'Synthetic sample result, not a real execution.'; });
    p = applyCommand(p, { type: 'results.import', input: { report } }, now + 3000); p.sample = true;
    if (await this.mutate(w => { w.projects.push(p); return w; }, 'Sample project loaded. All sample evidence is synthetic.')) { this.projectId = p.id; this.tab = 'overview'; this.buildId = null; this.render(); }
  }
}
if (!customElements.get('navyix-workbench')) customElements.define('navyix-workbench', NavyixWorkbench);
