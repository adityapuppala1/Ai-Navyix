/**
 * Navyix local workflow domain. No network, authentication or AI side effects.
 * Decisions are advisory and based on user-supplied, unverified records.
 * Production adapters must supply authorization, durable storage and provenance.
 */
export const POLICY_VERSION = 'local-readiness/1';
export const STAGES = ['design', 'build', 'test', 'release'];
export const MAX_REPORT_BYTES = 1_000_000;
const MAX_RECORDS = 200;
const MAX_REPORTS = 100;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OUTCOMES = ['passed', 'failed', 'skipped', 'error'];
const copy = value => structuredClone(value);
const newId = () => {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const fail = message => { throw new Error(message); };
const text = (value, label, limit = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) fail(`${label} must contain 1–${limit} characters.`);
  return value.trim();
};
const instant = (value, label, now) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO timestamp with a timezone.`);
  if (Date.parse(value) > now + 300_000) fail(`${label} cannot be more than five minutes in the future.`);
  return new Date(value).toISOString();
};
const find = (items, id, label) => items.find(item => item.id === id) ?? fail(`${label} does not belong to this project.`);
const capacity = items => { if (items.length >= MAX_RECORDS) fail('This local preview is limited to 200 records per collection. Export your project before continuing.'); };
const id = (prefix, items) => `${prefix}-${String(items.length + 1).padStart(3, '0')}`;
const revision = (record, expected) => { if (expected !== record.revision) fail('This record changed. Reload before editing.'); };
const url = value => {
  if (!value) return '';
  try { const parsed = new URL(value); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href; } catch { /* validation below */ }
  return fail('Evidence links must be HTTPS URLs without embedded credentials.');
};

export function createProject(input, now = Date.now()) {
  return {
    schemaVersion: 1, id: newId(), revision: 1,
    name: text(input.name, 'Project name', 100), goal: text(input.goal, 'Project goal'),
    owner: text(input.owner, 'Owner', 100), environment: text(input.environment || 'staging', 'Environment', 80),
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    requirementsVersion: 0, designVersion: 0,
    requirements: [], designs: [], builds: [], testCases: [], reports: [], assessments: [], activity: []
  };
}

function requirementInput(input, fallbackOwner) {
  return { title: text(input.title, 'Requirement title', 160), acceptance: text(input.acceptance, 'Acceptance criteria'), owner: text(input.owner || fallbackOwner, 'Owner', 100) };
}
function testInput(project, input) {
  const requirement = find(project.requirements, input.requirementId, 'Requirement');
  return { title: text(input.title, 'Test title', 160), requirementId: requirement.id,
    requirementRevision: requirement.revision, steps: text(input.steps, 'Test steps'),
    expected: text(input.expected, 'Expected outcome'), owner: text(input.owner || requirement.owner, 'Owner', 100) };
}

/** Atomic import: validate every row before returning a new state. No partial writes. */
export function parseReport(project, input, now = Date.now()) {
  let report = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_REPORT_BYTES) fail('Report exceeds the 1 MB limit.');
    try { report = JSON.parse(input); } catch { fail('Report is not valid JSON.'); }
  }
  if (!report || typeof report !== 'object' || Array.isArray(report) || report.schemaVersion !== 1) fail('Report schemaVersion must be 1.');
  if (report.projectId !== project.id) fail('Report belongs to a different project.');
  const runId = text(report.runId, 'Run ID', 120);
  if (project.reports.some(run => run.runId === runId)) fail('Run ID already exists. Import a new run ID; existing evidence is never overwritten.');
  if (project.reports.length >= MAX_REPORTS) fail('This preview is limited to 100 test runs per project.');
  const build = find(project.builds, report.buildId, 'Build');
  if (report.artifactDigest !== build.artifactDigest || report.environment !== build.environment) fail('Report artifact or environment does not match the selected build.');
  const executedAt = instant(report.executedAt, 'Execution time', now);
  if (Date.parse(executedAt) < Date.parse(build.builtAt)) fail('Test execution cannot precede the build.');
  if (!Array.isArray(report.results) || report.results.length < 1 || report.results.length > MAX_RECORDS) fail('Report must contain 1–200 test results.');
  const seen = new Set();
  const results = report.results.map(result => {
    if (!result || typeof result !== 'object') fail('Every result must be an object.');
    const testCase = find(project.testCases, result.testCaseId, 'Test case');
    if (seen.has(testCase.id)) fail(`Duplicate result for ${testCase.id}.`);
    seen.add(testCase.id);
    if (result.testCaseRevision !== testCase.revision) fail(`Test revision mismatch for ${testCase.id}.`);
    if (Date.parse(executedAt) < Date.parse(testCase.updatedAt)) fail(`Execution predates the current definition of ${testCase.id}.`);
    if (!OUTCOMES.includes(result.status)) fail(`Invalid outcome for ${testCase.id}. Use passed, failed, skipped or error.`);
    return { testCaseId: testCase.id, testCaseRevision: testCase.revision, status: result.status,
      note: typeof result.note === 'string' ? result.note.slice(0, 2000) : '' };
  });
  return { projectId: project.id, runId, buildId: build.id, artifactDigest: build.artifactDigest, environment: build.environment,
    executedAt, importedAt: new Date(now).toISOString(), sourceUrl: url(report.sourceUrl),
    provenance: 'user-supplied; not independently verified', results };
}

/** All writes return a copy. Saved assessments and prior test runs are append-only. */
export function applyCommand(project, command, now = Date.now()) {
  if (!project || project.schemaVersion !== 1) fail('Unsupported project data.');
  if (!command || typeof command.type !== 'string') fail('A command type is required.');
  const p = copy(project), input = command.input || {}, timestamp = new Date(now).toISOString();
  let detail = '';
  switch (command.type) {
    case 'requirement.add': {
      capacity(p.requirements);
      const item = { id: id('REQ', p.requirements), revision: 1, ...requirementInput(input, p.owner), reviewedRevision: null, createdAt: timestamp, updatedAt: timestamp };
      p.requirements.push(item); p.requirementsVersion++; detail = `Added ${item.id}: ${item.title}`; break;
    }
    case 'requirement.update': {
      const item = find(p.requirements, input.id, 'Requirement'); revision(item, input.expectedRevision);
      Object.assign(item, requirementInput(input, item.owner), { revision: item.revision + 1, reviewedRevision: null, updatedAt: timestamp });
      p.requirementsVersion++; detail = `Revised ${item.id}; linked evidence must be reassessed`; break;
    }
    case 'requirement.review': {
      const item = find(p.requirements, input.id, 'Requirement'); revision(item, input.expectedRevision);
      item.reviewedRevision = item.revision; item.reviewedAt = timestamp;
      detail = `Recorded local review of ${item.id} v${item.revision}`; break;
    }
    case 'design.add': {
      capacity(p.designs);
      if (!Array.isArray(input.requirementIds) || !input.requirementIds.length) fail('Link at least one requirement.');
      const requirements = [...new Set(input.requirementIds)].map(key => {
        const item = find(p.requirements, key, 'Requirement'); return { id: item.id, revision: item.revision };
      });
      const item = { id: id('DSN', p.designs), title: text(input.title, 'Design title', 160), decision: text(input.decision, 'Design decision', 8000),
        owner: text(input.owner || p.owner, 'Owner', 100), requirements, reviewedAt: null, createdAt: timestamp };
      p.designs.push(item); p.designVersion++; detail = `Added ${item.id}: ${item.title}`; break;
    }
    case 'design.review': {
      const item = find(p.designs, input.id, 'Design');
      if (item.requirements.some(ref => find(p.requirements, ref.id, 'Requirement').revision !== ref.revision)) fail('This design references an older requirement. Add a revised design record first.');
      if (item.reviewedAt) fail('This design is already reviewed.');
      item.reviewedAt = timestamp; p.designVersion++; detail = `Recorded local review of ${item.id}`; break;
    }
    case 'build.add': {
      capacity(p.builds);
      const commitSha = text(input.commitSha, 'Commit SHA', 64).toLowerCase();
      const artifactDigest = text(input.artifactDigest, 'Artifact digest', 71).toLowerCase();
      if (!COMMIT.test(commitSha)) fail('Use a complete 40- or 64-character hexadecimal commit SHA.');
      if (!DIGEST.test(artifactDigest)) fail('Use sha256: followed by 64 hexadecimal characters.');
      if (!['succeeded', 'failed'].includes(input.status)) fail('Build status must be succeeded or failed.');
      const builtAt = instant(input.builtAt || timestamp, 'Build time', now);
      const latestInput = Math.max(Date.parse(p.createdAt), ...p.requirements.map(r => Date.parse(r.updatedAt)), ...p.designs.map(d => Date.parse(d.createdAt)));
      if (Date.parse(builtAt) < latestInput) fail('Build predates current requirements or designs. Record a build of the current scope.');
      const item = { id: id('BLD', p.builds), label: text(input.label, 'Build label', 120), commitSha, artifactDigest,
        environment: text(input.environment || p.environment, 'Environment', 80), status: input.status, builtAt,
        requirementsVersion: p.requirementsVersion, designVersion: p.designVersion, sourceUrl: url(input.sourceUrl),
        provenance: 'manually recorded; not independently verified' };
      p.builds.push(item); detail = `Recorded ${item.id}: ${item.label}`; break;
    }
    case 'test.add': {
      capacity(p.testCases);
      const item = { id: id('TST', p.testCases), revision: 1, ...testInput(p, input), createdAt: timestamp, updatedAt: timestamp };
      p.testCases.push(item); detail = `Defined ${item.id}: ${item.title}; not executed`; break;
    }
    case 'test.update': {
      const item = find(p.testCases, input.id, 'Test'); revision(item, input.expectedRevision);
      Object.assign(item, testInput(p, input), { revision: item.revision + 1, updatedAt: timestamp });
      detail = `Revised ${item.id}; earlier executions do not verify this version`; break;
    }
    case 'results.import': {
      const report = parseReport(p, input.report, now); p.reports.push(report);
      detail = `Imported ${report.runId}: ${report.results.length} result(s)`; break;
    }
    case 'assessment.create': {
      if (p.assessments.length >= 100) fail('Export this project; the preview retains at most 100 assessments.');
      const assessment = assessProject(p, input, now);
      p.assessments.push({ id: id('ASM', p.assessments), ...assessment });
      detail = `Saved ${assessment.stage} readiness: ${assessment.status}`; break;
    }
    default: fail('Unknown workflow command.');
  }
  p.revision++; p.updatedAt = timestamp;
  p.activity = [{ at: timestamp, detail }, ...p.activity].slice(0, 100);
  return p;
}

/** Explainable local policy. No weighted score can override a mandatory failure. */
export function assessProject(project, target = {}, now = Date.now()) {
  const stage = target.stage || 'release';
  if (!STAGES.includes(stage)) fail('Unknown readiness stage.');
  const level = STAGES.indexOf(stage);
  const environment = text(target.environment || project.environment, 'Environment', 80);
  const build = target.buildId ? find(project.builds, target.buildId, 'Build') : null;
  const criteria = [];
  const add = (key, title, status, reason, action, owner = project.owner, evidence = []) => criteria.push({ key, title, status, reason, action, owner, evidence: copy(evidence) });
  add('scope', 'Project scope and acceptance criteria', project.requirements.length ? 'Met' : 'Unknown',
    project.requirements.length ? `${project.requirements.length} requirement(s) with acceptance criteria.` : 'There are no requirements to evaluate.', 'Add a requirement with measurable acceptance criteria.');
  if (level >= 1) for (const requirement of project.requirements) {
    const reviewed = requirement.reviewedRevision === requirement.revision;
    add(`review:${requirement.id}`, `${requirement.id} · Requirement review`, reviewed ? 'Met' : 'Unmet',
      reviewed ? `Version ${requirement.revision} has a local review record.` : 'The current requirement version is not reviewed.', 'Review this requirement version.', requirement.owner, [requirement]);
    const related = project.designs.filter(d => d.requirements.some(r => r.id === requirement.id));
    const latest = related.at(-1);
    const current = latest?.requirements.some(r => r.id === requirement.id && r.revision === requirement.revision);
    const status = !latest ? 'Unknown' : !current ? 'Stale' : latest.reviewedAt ? 'Met' : 'Unmet';
    add(`design:${requirement.id}`, `${requirement.id} · Linked design`, status,
      !latest ? 'No design record is linked.' : !current ? 'The latest design references an earlier requirement version.' : latest.reviewedAt ? 'The latest design has a local review record.' : 'The latest design is not reviewed.',
      'Add and review a design linked to the current requirement.', latest?.owner || requirement.owner, latest ? [latest] : []);
  }
  if (level >= 2) {
    const current = build && build.requirementsVersion === project.requirementsVersion && build.designVersion === project.designVersion;
    const status = !build ? 'Unknown' : build.environment !== environment ? 'Unmet' : !current ? 'Stale' : build.status === 'succeeded' ? 'Met' : 'Unmet';
    add('build', 'Exact build and environment', status,
      !build ? 'No build selected.' : build.environment !== environment ? 'The build belongs to a different environment.' : !current ? 'Requirements or designs changed after this build was recorded.' : build.status !== 'succeeded' ? 'The recorded build failed.' : 'Successful build recorded for this scope and environment.',
      'Record a successful build of the current scope, then select it.', project.owner, build ? [build] : []);
    for (const requirement of project.requirements) {
      const cases = project.testCases.filter(t => t.requirementId === requirement.id && t.requirementRevision === requirement.revision);
      add(`coverage:${requirement.id}`, `${requirement.id} · Test preparation`, cases.length ? 'Met' : 'Unknown',
        cases.length ? `${cases.length} test definition(s) cover this version. This is not proof of execution.` : 'No test definition covers this requirement version.',
        'Define or revise a linked test, its steps and expected result.', requirement.owner, cases);
    }
  }
  if (level >= 3) {
    add('test-count', 'Mandatory test definitions exist', project.testCases.length ? 'Met' : 'Unknown',
      project.testCases.length ? 'All defined tests are mandatory in this starter policy.' : 'No tests exist; an empty suite cannot establish readiness.', 'Add test cases.');
    for (const testCase of project.testCases) {
      const requirement = find(project.requirements, testCase.requirementId, 'Requirement');
      const eligible = build ? project.reports.filter(r => r.buildId === build.id && r.artifactDigest === build.artifactDigest && r.environment === environment)
        .flatMap(r => r.results.filter(x => x.testCaseId === testCase.id && x.testCaseRevision === testCase.revision).map(result => ({ run: r, result })))
        .sort((a, b) => Date.parse(a.run.executedAt) - Date.parse(b.run.executedAt) || Date.parse(a.run.importedAt) - Date.parse(b.run.importedAt)) : [];
      const latest = eligible.at(-1);
      let status = 'Unknown', reason = 'No execution result for this exact build, environment and test version.';
      if (testCase.requirementRevision !== requirement.revision) { status = 'Stale'; reason = 'Test definition references an earlier requirement version.'; }
      else if (latest) {
        if (['failed', 'error'].includes(latest.result.status)) { status = 'Unmet'; reason = `Latest execution is ${latest.result.status}.`; }
        else if (Date.parse(latest.run.executedAt) < now - 7 * 86400_000) { status = 'Stale'; reason = 'Latest execution is older than the seven-day evidence window.'; }
        else if (latest.result.status === 'passed') { status = 'Met'; reason = 'A passing result was supplied for the exact target. Provenance is not independently verified.'; }
        else { reason = 'Test was skipped; this is not a passing execution.'; }
      }
      const evidence = latest ? [{ testCase: copy(testCase), runId: latest.run.runId, executedAt: latest.run.executedAt,
        importedAt: latest.run.importedAt, artifactDigest: latest.run.artifactDigest, environment: latest.run.environment,
        sourceUrl: latest.run.sourceUrl, provenance: latest.run.provenance, result: latest.result }] : [testCase];
      add(`test:${testCase.id}`, `${testCase.id} · ${testCase.title}`, status, reason,
        'Resolve the failure or missing evidence, then import a new execution for the selected target.', testCase.owner, evidence);
    }
  }
  const status = criteria.some(c => c.status === 'Unmet') ? 'Blocked' : criteria.some(c => c.status === 'Unknown' || c.status === 'Stale') ? 'Insufficient evidence' : 'Ready';
  return { stage, status, policyVersion: POLICY_VERSION, projectId: project.id, projectName: project.name,
    projectRevision: project.revision, environment, buildId: build?.id || null, artifactDigest: build?.artifactDigest || null,
    evaluatedAt: new Date(now).toISOString(), advisory: true, sample: project.sample === true, evidenceTrust: project.sample ? 'synthetic sample evidence' : 'user-supplied; not independently verified',
    met: criteria.filter(c => c.status === 'Met').length, total: criteria.length, criteria };
}

export function reportTemplate(project, buildId, now = Date.now()) {
  const build = find(project.builds, buildId, 'Build');
  return { schemaVersion: 1, projectId: project.id, runId: `run-${now}`, buildId: build.id, artifactDigest: build.artifactDigest,
    environment: build.environment, executedAt: new Date(now).toISOString(), sourceUrl: '',
    results: project.testCases.map(t => ({ testCaseId: t.id, testCaseRevision: t.revision, status: 'skipped', note: 'Replace with the observed execution result. Navyix does not run tests in this preview.' })) };
}
