/** Browser-safe read-only adapter. Uses the existing same-origin session transport. */
const INTEGER = /^[1-9]\d{0,15}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const states = ['Reported success', 'Reported failure', 'Not completed', 'Missing', 'Skipped', 'Cancelled', 'Ambiguous', 'Missing timestamps'];
const fail = (code, message) => Object.assign(new Error(message), { code });
export class GitHubEvidenceClient {
  constructor(workspace) { this.workspace = workspace; this.version = 0; this.value = null; }
  clear() { this.version++; this.value = null; }
  async inspect({ buildId, runId, attempt }) {
    this.clear(); const version = this.version, api = this.workspace;
    const project = api.project, orgId = api.orgId, generation = api.generation;
    if (!api.authenticated || !orgId || !project) throw fail('CONTEXT_REQUIRED', 'Connect an authorized project first.');
    if (![runId, attempt].every(n => typeof n === 'string' && INTEGER.test(n) && Number.isSafeInteger(Number(n))) || Number(attempt) > 1000)
      throw fail('INVALID_RUN', 'Enter a numeric run ID and an attempt from 1 to 1000.');
    const build = project.builds.find(item => item.id === buildId);
    if (!build) throw fail('BUILD_REQUIRED', 'Select a recorded build.');
    const q = new URLSearchParams({ buildId, runId, attempt });
    const value = await api.request(`api/orgs/${orgId}/projects/${project.id}/github-evidence?${q}`);
    if (this.version !== version || api.generation !== generation || api.orgId !== orgId || api.project?.id !== project.id || api.project.revision !== project.revision)
      throw fail('STALE_CONTEXT', 'The selected project or session changed. Inspect again.');
    const t = value?.target, s = value?.source;
    if (value?.schemaVersion !== 1 || value.kind !== 'github-run-observation' || value.orgId !== orgId || value.projectId !== project.id || value.projectRevision !== project.revision ||
        t?.buildId !== build.id || t.commitSha !== build.commitSha || t.artifactDigest !== build.artifactDigest || t.environment !== build.environment ||
        !s || s.id !== Number(runId) || s.attempt !== Number(attempt) || s.commitSha !== build.commitSha || !REPO.test(s.repository || '') ||
        s.url !== `https://github.com/${s.repository}/actions/runs/${runId}/attempts/${attempt}` ||
        !['Reported success', 'Not successful', 'Not completed', 'Insufficient evidence'].includes(value.summary) ||
        value.artifactVerified !== false || value.testCoverageVerified !== false || value.readinessEffect !== 'none' ||
        !Number.isFinite(Date.parse(value.collectedAt)) || !/^[a-f0-9]{64}$/.test(value.contentSha256 || '') ||
        !Array.isArray(value.criteria) || !value.criteria.length || value.criteria.length > 30 ||
        value.criteria.some(c => !c || typeof c.name !== 'string' || c.name.length > 200 || !states.includes(c.state) || typeof c.reason !== 'string' || c.reason.length > 1000) ||
        !Array.isArray(value.jobs) || value.jobs.length > 500 || !Array.isArray(value.limitations) || value.limitations.some(s => typeof s !== 'string' || s.length > 1000))
      throw fail('INVALID_EVIDENCE', 'Evidence did not match the selected project, build and run. Nothing was accepted.');
    this.value = value; return value;
  }
}
