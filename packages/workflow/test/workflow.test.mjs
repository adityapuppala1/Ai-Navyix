import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyCommand, assessProject, parseReport, reportTemplate } from '../src/workflow.mjs';
const start = Date.parse('2026-11-11T12:00:00Z');
const sha = 'a'.repeat(40), digest = `sha256:${'b'.repeat(64)}`;
const cmd = (p, type, input = {}, now = start + 10_000) => applyCommand(p, { type, input }, now);
function prepared() {
  let p = createProject({ name: 'Portal', goal: 'Reliable customer sign-in', owner: 'QA', environment: 'staging' }, start);
  p = cmd(p, 'requirement.add', { title: 'One-time login', acceptance: 'A reused OTP is rejected.' });
  p = cmd(p, 'requirement.review', { id: 'REQ-001', expectedRevision: 1 });
  p = cmd(p, 'design.add', { title: 'OTP storage', decision: 'Hash the code; atomically mark it used.', requirementIds: ['REQ-001'] });
  p = cmd(p, 'design.review', { id: 'DSN-001' });
  p = cmd(p, 'build.add', { label: 'candidate-1', commitSha: sha, artifactDigest: digest, status: 'succeeded' });
  return cmd(p, 'test.add', { title: 'Reject reuse', requirementId: 'REQ-001', steps: 'Submit the code twice.', expected: 'The second attempt is rejected.' });
}
function report(p, status = 'passed', overrides = {}) {
  return { ...reportTemplate(p, 'BLD-001', start + 20_000), runId: 'run-1', results: [{ testCaseId: 'TST-001', testCaseRevision: 1, status }], ...overrides };
}
const assess = (p, stage = 'release', now = start + 30_000, overrides = {}) => assessProject(p, { stage, buildId: p.builds[0]?.id, ...overrides }, now);
const result = (p, status = 'passed', extra = {}) => cmd(p, 'results.import', { report: report(p, status, extra) }, start + 30_000);

test('empty project cannot be ready even with an empty test suite', () => {
  const p = createProject({ name: 'A', goal: 'B', owner: 'C' }, start);
  for (const stage of ['design', 'build', 'test', 'release']) assert.equal(assess(p, stage).status, 'Insufficient evidence');
});
test('input validation rejects blank project name', () => assert.throws(() => createProject({ name: ' ', goal: 'x', owner: 'y' }), /Project name/));
test('requirements need non-empty acceptance criteria', () => assert.throws(() => cmd(prepared(), 'requirement.add', { title: 'No criteria' }), /Acceptance/));
test('planned tests alone never establish release readiness', () => assert.equal(assess(prepared()).status, 'Insufficient evidence'));
test('prepared build is ready to test before tests execute', () => assert.equal(assess(prepared(), 'test').status, 'Ready'));
test('full design-build-test loop becomes locally ready with passing evidence', () => assert.equal(assess(result(prepared())).status, 'Ready'));
test('failed test blocks release, not readiness to test', () => {
  const p = result(prepared(), 'failed'); assert.equal(assess(p).status, 'Blocked'); assert.equal(assess(p, 'test').status, 'Ready');
});
for (const status of ['failed', 'error']) test(`${status} is a blocker`, () => assert.equal(assess(result(prepared(), status)).status, 'Blocked'));
test('skipped test remains unknown', () => assert.equal(assess(result(prepared(), 'skipped')).status, 'Insufficient evidence'));
test('fresh pass after failure clears blocker and preserves both runs', () => {
  let p = result(prepared(), 'failed');
  p = cmd(p, 'results.import', { report: report(p, 'passed', { runId: 'run-2', executedAt: new Date(start + 40_000).toISOString() }) }, start + 50_000);
  assert.equal(assess(p, 'release', start + 60_000).status, 'Ready'); assert.equal(p.reports.length, 2); assert.equal(p.reports[0].results[0].status, 'failed');
});
test('out-of-order import cannot replace newer failure with older pass', () => {
  let p = result(prepared(), 'failed', { executedAt: new Date(start + 40_000).toISOString() });
  p = cmd(p, 'results.import', { report: report(p, 'passed', { runId: 'old' }) }, start + 50_000);
  assert.equal(assess(p).status, 'Blocked');
});
test('unchanged stale passing evidence cannot release', () => assert.equal(assess(result(prepared()), 'release', start + 8 * 86400_000).status, 'Insufficient evidence'));
test('stale failed evidence remains a blocker until resolution', () => assert.equal(assess(result(prepared(), 'failed'), 'release', start + 8 * 86400_000).status, 'Blocked'));
test('wrong target environment is a blocker', () => assert.equal(assess(result(prepared()), 'release', start + 30_000, { environment: 'production' }).status, 'Blocked'));
test('new build cannot reuse old build results', () => {
  let p = result(prepared()); p = cmd(p, 'build.add', { label: 'candidate-2', commitSha: sha, artifactDigest: `sha256:${'c'.repeat(64)}`, status: 'succeeded' });
  assert.equal(assess(p, 'release', start + 30_000, { buildId: 'BLD-002' }).status, 'Insufficient evidence');
});
test('requirement revision invalidates review, design, build and test coverage', () => {
  let p = result(prepared()); p = cmd(p, 'requirement.update', { id: 'REQ-001', expectedRevision: 1, title: 'OTP', acceptance: 'Reject reuse and expired codes.' });
  const a = assess(p); assert.equal(a.status, 'Blocked');
  assert.equal(a.criteria.find(c => c.key === 'design:REQ-001').status, 'Stale');
  assert.equal(a.criteria.find(c => c.key === 'build').status, 'Stale');
  assert.equal(a.criteria.find(c => c.key === 'test:TST-001').status, 'Stale');
});
test('optimistic revision prevents accidental overwrite', () => assert.throws(() => cmd(prepared(), 'requirement.update', { id: 'REQ-001', expectedRevision: 9 }), /changed/));
test('design cannot reference a requirement in another project', () => assert.throws(() => cmd(prepared(), 'design.add', { title: 'X', decision: 'Y', requirementIds: ['REQ-999'] }), /does not belong/));
test('new unreviewed design is not hidden behind an old reviewed design', () => {
  const p = cmd(prepared(), 'design.add', { title: 'New decision', decision: 'Revise persistence.', requirementIds: ['REQ-001'] });
  assert.equal(assess(p, 'build').status, 'Blocked');
});
test('outdated design cannot be reviewed', () => {
  const p = cmd(prepared(), 'requirement.update', { id: 'REQ-001', expectedRevision: 1, title: 'OTP', acceptance: 'New requirement.' });
  assert.throws(() => cmd(p, 'design.review', { id: 'DSN-001' }), /older requirement/);
});
test('test revision invalidates prior executions', () => {
  let p = result(prepared()); p = cmd(p, 'test.update', { id: 'TST-001', expectedRevision: 1, title: 'Revised test', requirementId: 'REQ-001', steps: 'New steps.', expected: 'New expectation.' });
  assert.equal(assess(p).status, 'Insufficient evidence');
});
test('failed build blocks readiness to test', () => {
  let p = prepared(); p = cmd(p, 'build.add', { label: 'failed', commitSha: sha, artifactDigest: digest, status: 'failed' });
  assert.equal(assess(p, 'test', start + 30_000, { buildId: 'BLD-002' }).status, 'Blocked');
});
test('short commit SHA is rejected', () => assert.throws(() => cmd(prepared(), 'build.add', { label: 'x', commitSha: 'abc1234', artifactDigest: digest, status: 'succeeded' }), /complete/));
test('invalid artifact digest is rejected', () => assert.throws(() => cmd(prepared(), 'build.add', { label: 'x', commitSha: sha, artifactDigest: 'sha256:no', status: 'succeeded' }), /sha256/));
test('unsafe evidence URL is rejected', () => assert.throws(() => cmd(prepared(), 'build.add', { label: 'x', commitSha: sha, artifactDigest: digest, status: 'succeeded', sourceUrl: 'javascript:alert(1)' }), /HTTPS/));
test('URLs with embedded credentials are rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { sourceUrl: 'https://user:pass@example.com/' }), start + 30_000), /credentials/); });
test('missing build never borrows any previous results', () => assert.equal(assessProject(result(prepared()), { stage: 'release' }, start + 30_000).status, 'Insufficient evidence'));
test('report JSON parses and normalizes', () => { const p = prepared(); assert.equal(parseReport(p, JSON.stringify(report(p)), start + 30_000).results[0].status, 'passed'); });
test('invalid JSON is rejected', () => assert.throws(() => parseReport(prepared(), '{oops'), /valid JSON/));
test('oversized report is rejected', () => assert.throws(() => parseReport(prepared(), 'x'.repeat(1_000_001)), /1 MB/));
test('empty result set is rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { results: [] }), start + 30_000), /1–200/); });
test('report schema mismatch rejected', () => assert.throws(() => parseReport(prepared(), { schemaVersion: 2 }), /schemaVersion/));
test('report from other project build rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { buildId: 'BLD-999' }), start + 30_000), /does not belong/); });
test('mismatched artifact rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { artifactDigest: `sha256:${'c'.repeat(64)}` }), start + 30_000), /artifact or environment/); });
test('mismatched report environment rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { environment: 'prod' }), start + 30_000), /artifact or environment/); });
test('duplicate run rejected without overwriting original', () => { const p = result(prepared()); assert.throws(() => result(p), /already exists/); assert.equal(p.reports.length, 1); });
test('duplicate test rows rejected', () => { const p = prepared(), r = report(p); r.results.push(r.results[0]); assert.throws(() => parseReport(p, r, start + 30_000), /Duplicate result/); });
test('unknown test rejected atomically', () => { const p = prepared(), r = report(p); r.results.push({ testCaseId: 'TST-999', testCaseRevision: 1, status: 'passed' }); assert.throws(() => cmd(p, 'results.import', { report: r }), /does not belong/); assert.equal(p.reports.length, 0); });
test('test revision mismatch rejected', () => { const p = prepared(), r = report(p); r.results[0].testCaseRevision = 7; assert.throws(() => parseReport(p, r, start + 30_000), /revision mismatch/); });
test('unrecognized outcome is not treated as pass', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'success'), start + 30_000), /Invalid outcome/); });
test('future execution rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { executedAt: new Date(start + 3_600_000).toISOString() }), start + 30_000), /future/); });
test('execution before build rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { executedAt: new Date(start).toISOString() }), start + 30_000), /precede/); });
test('timestamp without timezone rejected', () => { const p = prepared(); assert.throws(() => parseReport(p, report(p, 'passed', { executedAt: '2026-11-11T12:00:20' }), start + 30_000), /timezone/); });
test('assessments snapshot evidence and remain unchanged after edits', () => {
  let p = result(prepared()); p = cmd(p, 'assessment.create', { stage: 'release', buildId: 'BLD-001' }, start + 30_000);
  const saved = JSON.stringify(p.assessments[0]);
  p = cmd(p, 'requirement.update', { id: 'REQ-001', expectedRevision: 1, title: 'Changed', acceptance: 'Changed expected behavior.' }, start + 40_000);
  assert.equal(JSON.stringify(p.assessments[0]), saved); assert.equal(p.assessments[0].status, 'Ready'); assert.equal(assess(p).status, 'Blocked');
});
test('command does not mutate its input', () => { const p = prepared(), before = JSON.stringify(p); result(p); assert.equal(JSON.stringify(p), before); });
test('assessment evidence cannot mutate project data', () => { const p = prepared(), a = assess(p); a.criteria.find(c => c.key === 'review:REQ-001').evidence[0].title = 'tampered'; assert.equal(p.requirements[0].title, 'One-time login'); });
test('invalid stage and unknown command fail closed', () => { assert.throws(() => assess(prepared(), 'deploy'), /Unknown readiness/); assert.throws(() => cmd(prepared(), 'approve-all'), /Unknown workflow/); });
test('template defaults to skipped, never fabricated passes', () => assert.equal(reportTemplate(prepared(), 'BLD-001', start + 20_000).results[0].status, 'skipped'));
test('local trust and advisory flag are present in exported decisions', () => { const a = assess(result(prepared())); assert.equal(a.advisory, true); assert.match(a.evidenceTrust, /not independently verified/); });

test('report from another project rejected even when local record IDs match', () => { const a = prepared(), b = prepared(); assert.notEqual(a.id, b.id); assert.throws(() => parseReport(b, report(a), start + 30_000), /different project/); });
