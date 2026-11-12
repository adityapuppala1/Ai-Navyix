/** Read-only GitHub observations. No workflow dispatch, code downloads, or readiness mutation. */
import { createHash } from 'node:crypto';
import { ApiError, object, uuid } from './errors.mjs';
const ORIGIN = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const STATUSES = ['requested', 'waiting', 'pending', 'queued', 'in_progress', 'completed'];
const CONCLUSIONS = ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'];
const bad = () => new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned incomplete or inconsistent evidence.');
const input = message => new ApiError(400, 'INVALID_INPUT', message);
const positive = value => Number.isSafeInteger(value) && value > 0;
const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const safeTime = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 && Date.parse(value) <= now + 300_000;
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function number(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || !positive(Number(value))) throw input(`${label} must be a positive safe integer.`);
  return Number(value);
}
/** Trusted deployment configuration, never a browser-supplied repository/token/URL. */
export function githubConnections(env) {
  if (!env.NAVYIX_GITHUB_ENABLED || env.NAVYIX_GITHUB_ENABLED === 'false') return [];
  if (env.NAVYIX_GITHUB_ENABLED !== 'true' || env.NAVYIX_API_ENABLED !== 'true') throw new Error('GitHub evidence requires the authenticated API.');
  let rows;
  try {
    if (!env.NAVYIX_GITHUB_CONNECTIONS || env.NAVYIX_GITHUB_CONNECTIONS.length > 50_000) throw new Error();
    rows = JSON.parse(env.NAVYIX_GITHUB_CONNECTIONS);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50) throw new Error();
    const seen = new Set();
    return rows.map(row => {
      object(row, ['orgId', 'projectId', 'repository', 'repositoryId', 'workflowIds', 'requiredJobs', 'events', 'tokenEnv']);
      const orgId = uuid(row.orgId), projectId = uuid(row.projectId), key = `${orgId}/${projectId}`;
      if (seen.has(key)) throw new Error(); seen.add(key);
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(row.repository || '') || ['.', '..'].includes(row.repository.split('/')[1]) || !positive(row.repositoryId)) throw new Error();
      for (const [field, max] of [['workflowIds', 20], ['requiredJobs', 30], ['events', 3]]) {
        if (!Array.isArray(row[field]) || !row[field].length || row[field].length > max || new Set(row[field]).size !== row[field].length) throw new Error();
      }
      if (!row.workflowIds.every(positive) || !row.requiredJobs.every(s => text(s) && s === s.trim()) || !row.events.every(s => ['push', 'workflow_dispatch', 'pull_request'].includes(s))) throw new Error();
      if (!/^NAVYIX_GITHUB_TOKEN_[A-Z0-9_]{1,64}$/.test(row.tokenEnv || '') || !text(env[row.tokenEnv], 1024) || /\s/.test(env[row.tokenEnv])) throw new Error();
      return Object.freeze({ orgId, projectId, repository: row.repository, repositoryId: row.repositoryId,
        workflowIds: Object.freeze([...row.workflowIds]), requiredJobs: Object.freeze([...row.requiredJobs]), events: Object.freeze([...row.events]), tokenEnv: row.tokenEnv });
    });
  } catch { throw new Error('Invalid GitHub evidence configuration. Check approved project/repository bindings and secret references; values are not logged.'); }
}
function runRecord(raw, binding, expected, now) {
  if (!raw || raw.id !== expected.runId || raw.run_attempt !== expected.attempt || raw.head_sha !== expected.commitSha ||
      !binding.workflowIds.includes(raw.workflow_id) || raw.repository?.id !== binding.repositoryId || raw.head_repository?.id !== binding.repositoryId ||
      raw.repository?.full_name?.toLowerCase() !== binding.repository.toLowerCase() || !binding.events.includes(raw.event) ||
      !STATUSES.includes(raw.status) || (raw.status === 'completed' ? !CONCLUSIONS.includes(raw.conclusion) : raw.conclusion != null) ||
      !safeTime(raw.created_at, now) || !safeTime(raw.updated_at, now) || Date.parse(raw.updated_at) < Date.parse(raw.created_at)) throw bad();
  return { id: raw.id, attempt: raw.run_attempt, workflowId: raw.workflow_id, commitSha: raw.head_sha, event: raw.event,
    status: raw.status, conclusion: raw.conclusion ?? null, createdAt: raw.created_at, updatedAt: raw.updated_at };
}
function jobRecord(raw, expected, now) {
  if (!raw || !positive(raw.id) || raw.run_id !== expected.runId || raw.head_sha !== expected.commitSha ||
      (raw.run_attempt !== undefined && raw.run_attempt !== expected.attempt) || !text(raw.name) || !STATUSES.includes(raw.status) ||
      (raw.status === 'completed' ? !CONCLUSIONS.includes(raw.conclusion) : raw.conclusion != null) ||
      (raw.started_at != null && !safeTime(raw.started_at, now)) || (raw.completed_at != null && !safeTime(raw.completed_at, now)) ||
      (raw.completed_at && (!raw.started_at || Date.parse(raw.completed_at) < Date.parse(raw.started_at)))) throw bad();
  return { id: raw.id, name: raw.name, status: raw.status, conclusion: raw.conclusion ?? null,
    startedAt: raw.started_at ?? null, completedAt: raw.completed_at ?? null };
}
function criteriaFor(jobs, required) {
  return required.map(name => {
    const matches = jobs.filter(job => job.name === name), job = matches[0];
    let state = 'Missing', reason = 'No job with this exact approved name was returned.';
    if (matches.length > 1) { state = 'Ambiguous'; reason = 'Multiple jobs use this name; refine the approved job names.'; }
    else if (job) {
      if (job.status !== 'completed') { state = 'Not completed'; reason = 'This job has not completed.'; }
      else if (job.conclusion === 'skipped') { state = 'Skipped'; reason = 'Skipped is not an observed successful execution.'; }
      else if (job.conclusion === 'cancelled') { state = 'Cancelled'; reason = 'The job was cancelled.'; }
      else if (job.conclusion !== 'success') { state = 'Reported failure'; reason = `GitHub reports ${job.conclusion}; no successful completion is established.`; }
      else if (!job.startedAt || !job.completedAt) { state = 'Missing timestamps'; reason = 'Success lacks execution timestamps.'; }
      else { state = 'Reported success'; reason = 'GitHub reports successful job completion; this does not verify test-case coverage or an artifact.'; }
    }
    return { name, state, reason, jobIds: matches.map(job => job.id) };
  });
}
async function readJson(response, signal, budget) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw bad();
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1_000_000)) { await response.body.cancel(); throw bad(); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; budget.bytes += part.value.byteLength;
      if (bytes > 1_000_000 || budget.bytes > 4_000_000) throw bad();
      chunks.push(part.value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Fixed HTTPS origin and GET only. Credentials never leave this origin; redirects are rejected. */
export class GitHubEvidenceService {
  constructor(workflow, connections, { fetcher = fetch, secrets = process.env, clock = Date.now } = {}) {
    this.workflow = workflow; this.connections = connections; this.fetcher = fetcher; this.secrets = secrets; this.clock = clock;
    this.active = new Set(); this.nextAllowed = new Map(); this.tokenBackoff = new Map();
  }
  async inspect(principal, orgId, projectId, target) {
    orgId = uuid(orgId); projectId = uuid(projectId);
    object(target, ['buildId', 'runId', 'attempt']);
    if (!/^BLD-\d{3}$/.test(target.buildId || '')) throw input('Select a recorded build.');
    const runId = number(target.runId, 'Run ID'), attempt = number(target.attempt, 'Attempt');
    if (attempt > 1000) throw input('Attempt is outside the supported range.');
    const project = await this.workflow.get(principal, orgId, projectId); // Trusted database membership checks, before network.
    const binding = this.connections.find(row => row.orgId === orgId && row.projectId === projectId);
    if (!binding) throw new ApiError(404, 'GITHUB_NOT_CONFIGURED', 'No approved GitHub evidence connection is available for this project.');
    const build = project.builds.find(row => row.id === target.buildId);
    if (!build || !SHA.test(build.commitSha || '')) throw input('The build must contain a complete commit SHA.');
    const key = `${orgId}/${projectId}`, now = this.clock();
    if (this.active.has(key) || this.active.size >= 4 || now < (this.nextAllowed.get(key) || 0) || now < (this.tokenBackoff.get(binding.tokenEnv) || 0))
      throw new ApiError(429, 'GITHUB_BACKOFF', 'GitHub evidence is busy or rate limited. Wait before explicitly retrying.');
    this.active.add(key); this.nextAllowed.set(key, now + 10_000);
    try {
      const secret = this.secrets[binding.tokenEnv];
      if (!text(secret, 1024) || /\s/.test(secret)) throw new ApiError(503, 'GITHUB_UNAVAILABLE', 'The approved GitHub connection is unavailable.');
      const expected = { runId, attempt, commitSha: build.commitSha }, budget = { bytes: 0 };
      const signal = AbortSignal.timeout(10_000);
      const prefix = `/repos/${binding.repository}/actions/runs/${runId}/attempts/${attempt}`;
      const get = async path => {
        const response = await this.fetcher(ORIGIN + path, { method: 'GET', redirect: 'error', cache: 'no-store', signal,
          headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${secret}`, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'Navyix-evidence-readonly' } });
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 429 || (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'))) {
            const retry = Number(response.headers.get('retry-after'));
            const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
            const delay = Math.max(60_000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0, Number.isFinite(reset) ? reset - this.clock() : 0);
            this.tokenBackoff.set(binding.tokenEnv, Math.min(Number.MAX_SAFE_INTEGER, this.clock() + delay));
            throw new ApiError(429, 'GITHUB_BACKOFF', 'GitHub rate limit reached. Wait before explicitly retrying.');
          }
          if ([401, 403, 404].includes(response.status)) throw new ApiError(503, 'GITHUB_UNAVAILABLE', 'The approved run is unavailable or its connection lacks read access.');
          throw new ApiError(503, 'GITHUB_UNAVAILABLE', 'GitHub evidence could not be collected. No readiness result was changed.');
        }
        return readJson(response, signal, budget);
      };
      const first = runRecord(await get(prefix), binding, expected, this.clock());
      const jobs = [], seen = new Set(); let total;
      for (let page = 1; page <= 5; page++) {
        const data = await get(`${prefix}/jobs?per_page=100&page=${page}`);
        if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > 500 || !Array.isArray(data.jobs) || data.jobs.length > 100) throw bad();
        if (total !== undefined && total !== data.total_count) throw new ApiError(409, 'EVIDENCE_CHANGED', 'The run changed during collection. Explicitly retry after it settles.');
        total = data.total_count;
        for (const raw of data.jobs) {
          const job = jobRecord(raw, expected, this.clock());
          if (seen.has(job.id)) throw bad(); seen.add(job.id); jobs.push(job);
        }
        if (jobs.length > total || (jobs.length < total && data.jobs.length !== 100)) throw bad();
        if (jobs.length === total) break;
      }
      if (jobs.length !== total) throw bad();
      const second = runRecord(await get(prefix), binding, expected, this.clock());
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new ApiError(409, 'EVIDENCE_CHANGED', 'The run changed during collection. Explicitly retry after it settles.');
      // Recheck revocation and revision AFTER external work. Never return stale authorized content.
      const current = await this.workflow.get(principal, orgId, projectId);
      if (current.revision !== project.revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Project changed during evidence collection. Reload before retrying.');
      const criteria = criteriaFor(jobs, binding.requiredJobs);
      const summary = first.status !== 'completed' ? 'Not completed' : first.conclusion !== 'success' ? 'Not successful' :
        criteria.every(c => c.state === 'Reported success') ? 'Reported success' : 'Insufficient evidence';
      const observation = { schemaVersion: 1, kind: 'github-run-observation', orgId, projectId, projectRevision: project.revision,
        target: { buildId: build.id, commitSha: build.commitSha, artifactDigest: build.artifactDigest, environment: build.environment },
        source: { repository: binding.repository, repositoryId: binding.repositoryId, ...first,
          url: `https://github.com/${binding.repository}/actions/runs/${runId}/attempts/${attempt}` },
        collectedAt: new Date(this.clock()).toISOString(), summary, criteria, jobs,
        artifactVerified: false, testCoverageVerified: false, readinessEffect: 'none',
        limitations: ['Job metadata only; no test reports, source code, logs or artifact bytes were downloaded.',
          'The recorded artifact digest and environment are local context, not attested by this workflow metadata.',
          'This is a point-in-time API observation, not a release approval, signed attestation or durable audit record.'] };
      return { ...observation, contentSha256: fingerprint(observation) };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'GITHUB_UNAVAILABLE', 'GitHub evidence could not be collected. No readiness result was changed.');
    } finally { this.active.delete(key); }
  }
}
