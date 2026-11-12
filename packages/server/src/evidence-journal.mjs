/** Durable observations, never test executions, artifact attestations or readiness approvals. */
import { createHash, randomUUID } from 'node:crypto';
import { ApiError, denied, object, uuid } from './errors.mjs';
import { isTransactionConflict } from './transaction-errors.mjs';

const READ = ['OWNER', 'ADMIN', 'CONTRIBUTOR', 'REVIEWER', 'VIEWER'];
const WRITE = ['OWNER', 'ADMIN', 'CONTRIBUTOR'];
export const JOURNAL_LIMIT = 100;
export const OBSERVATION_BYTES = 500_000;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const journalHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const invalid = message => new ApiError(400, 'INVALID_INPUT', message);
const inconsistent = () => new ApiError(502, 'INVALID_OBSERVATION', 'The collected observation does not match the requested target.');
const corrupt = () => new ApiError(503, 'JOURNAL_INTEGRITY', 'Saved evidence failed its integrity check. No readiness decision was changed.');
function target(input) {
  object(input, ['expectedRevision', 'buildId', 'runId', 'attempt']);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !/^BLD-\d{3}$/.test(input.buildId || '')) throw invalid('Select a current project revision and build.');
  for (const key of ['runId', 'attempt']) {
    if (typeof input[key] !== 'string' || !/^[1-9]\d{0,15}$/.test(input[key]) || !Number.isSafeInteger(Number(input[key]))) throw invalid('Run and attempt must be positive integer strings.');
  }
  if (Number(input.attempt) > 1000) throw invalid('Attempt is outside the supported range.');
  return { expectedRevision: input.expectedRevision, buildId: input.buildId, runId: input.runId, attempt: input.attempt };
}
async function authorize(tx, projectId, write = false) {
  const actor = await tx.actor();
  if (!actor?.active || !actor.userActive || !actor.organizationActive || !READ.includes(actor.role)) throw denied();
  const membership = await tx.projectMembership(projectId, actor.userId);
  if (!membership?.active || !READ.includes(membership.role)) throw denied();
  if (write && (!WRITE.includes(actor.role) || !WRITE.includes(membership.role))) throw new ApiError(403, 'FORBIDDEN', 'Your organization and project roles cannot collect evidence.');
  return actor;
}
function currentBuild(project, input) {
  if (!project) throw denied();
  if (project.revision !== input.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Project changed. Reload before collecting evidence.');
  const build = project.builds.find(b => b.id === input.buildId);
  if (!build) throw invalid('Select a build belonging to this project.');
  return build;
}
/** This validates the trusted collector's output, not arbitrary browser-uploaded JSON. */
function validateObservation(observation, orgId, projectId, input, build, now) {
  if (!observation || Buffer.byteLength(JSON.stringify(observation)) > OBSERVATION_BYTES) throw inconsistent();
  const { contentSha256, ...original } = observation;
  if (contentSha256 !== createHash('sha256').update(JSON.stringify(original)).digest('hex')) throw inconsistent();
  if (observation.schemaVersion !== 1 || observation.kind !== 'github-run-observation' || observation.orgId !== orgId || observation.projectId !== projectId ||
      observation.projectRevision !== input.expectedRevision || observation.target?.buildId !== build.id || observation.target?.commitSha !== build.commitSha ||
      observation.target?.artifactDigest !== build.artifactDigest || observation.target?.environment !== build.environment ||
      observation.source?.id !== Number(input.runId) || observation.source?.attempt !== Number(input.attempt) || observation.source?.commitSha !== build.commitSha ||
      observation.artifactVerified !== false || observation.testCoverageVerified !== false || observation.readinessEffect !== 'none' ||
      !Array.isArray(observation.jobs) || observation.jobs.length > 500 || !Array.isArray(observation.criteria) || observation.criteria.length > 30 ||
      !['Reported success', 'Not completed', 'Not successful', 'Insufficient evidence'].includes(observation.summary)) throw inconsistent();
  const time = Date.parse(observation.collectedAt);
  if (!Number.isFinite(time) || time > now + 300_000 || time < now - 120_000) throw inconsistent();
  // Collector-generated links are reconstructed so stored exports never become open redirects.
  const repo = observation.source.repository;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo || '') || ['.', '..'].includes(repo.split('/')[1]) ||
      observation.source.url !== `https://github.com/${repo}/actions/runs/${input.runId}/attempts/${input.attempt}`) throw inconsistent();
}
export function verifyJournalRecord(record, orgId, projectId) {
  if (!record || record.orgId !== orgId || record.projectId !== projectId || record.observation?.orgId !== orgId || record.observation?.projectId !== projectId ||
      record.projectRevision !== record.observation?.projectRevision || record.observation?.kind !== 'github-run-observation' ||
      record.observation?.artifactVerified !== false || record.observation?.testCoverageVerified !== false || record.observation?.readinessEffect !== 'none' ||
      journalHash(record.observation) !== record.recordSha256) throw corrupt();
  return record;
}
function replay(prior, hash) {
  if (prior.requestHash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The request identifier already belongs to a different operation.');
  return structuredClone(prior.result);
}
export class EvidenceJournalService {
  constructor(repository, collector, { clock = Date.now, newId = randomUUID } = {}) {
    this.repository = repository; this.collector = collector; this.clock = clock; this.newId = newId;
  }
  async transaction(principal, orgId, operation) {
    if (!principal || typeof principal.issuer !== 'string' || !principal.issuer || typeof principal.subject !== 'string' || !principal.subject) throw new ApiError(401, 'UNAUTHENTICATED', 'A verified identity is required.');
    try { return await this.repository.transaction({ principal, orgId: uuid(orgId) }, operation); }
    catch (error) {
      if (isTransactionConflict(error)) throw new ApiError(409, 'CONFLICT', 'Concurrent change. Reload or retry the same request identifier.');
      throw error;
    }
  }
  async capture(principal, orgId, projectId, body, requestId) {
    orgId = uuid(orgId); projectId = uuid(projectId); requestId = uuid(requestId);
    const input = target(body), fingerprint = journalHash({ operation: 'github.observation.capture', projectId, input });
    const preflight = await this.transaction(principal, orgId, async tx => {
      const actor = await authorize(tx, projectId, true);
      const prior = await tx.receipt(actor.userId, requestId);
      if (prior) return { replay: replay(prior, fingerprint) }; // Reauthorize, but never refetch on retry after commit.
      currentBuild(await tx.project(projectId), input);
      if (await tx.count(projectId) >= JOURNAL_LIMIT) throw new ApiError(409, 'JOURNAL_LIMIT', 'The pilot retains at most 100 observations per project.');
      return {};
    });
    if (preflight.replay) return preflight.replay;
    if (!this.collector) throw new ApiError(503, 'GITHUB_NOT_CONFIGURED', 'Collection is disabled. Previously saved observations remain readable.');
    // No open database transaction while calling GitHub. Nothing supplied by the browser is accepted as evidence.
    const observation = await this.collector.inspect(principal, orgId, projectId, { buildId: input.buildId, runId: input.runId, attempt: input.attempt });
    return this.transaction(principal, orgId, async tx => {
      const actor = await authorize(tx, projectId, true);
      const prior = await tx.receipt(actor.userId, requestId);
      if (prior) return replay(prior, fingerprint);
      const build = currentBuild(await tx.project(projectId, true), input); // Lock serializes journal capacity and scope checks.
      if (await tx.count(projectId) >= JOURNAL_LIMIT) throw new ApiError(409, 'JOURNAL_LIMIT', 'The pilot retains at most 100 observations per project.');
      const now = this.clock(); validateObservation(observation, orgId, projectId, input, build, now);
      const record = { id: this.newId(), orgId, projectId, actorId: actor.userId, requestId,
        projectRevision: input.expectedRevision, recordedAt: new Date(now).toISOString(), recordSha256: journalHash(observation), observation: structuredClone(observation) };
      const ack = { observationId: record.id, orgId, projectId, projectRevision: record.projectRevision, requestId, recordSha256: record.recordSha256 };
      await tx.insert(record);
      await tx.audit(record, fingerprint);
      await tx.saveReceipt(actor.userId, requestId, fingerprint, ack);
      return ack; // Does not modify WorkflowState, WorkflowSnapshot or a readiness criterion.
    });
  }
  async list(principal, orgId, projectId, { after, limit = 20 } = {}) {
    orgId = uuid(orgId); projectId = uuid(projectId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw invalid('Limit must be 1–20.');
    if (after !== undefined) after = uuid(after);
    return this.transaction(principal, orgId, async tx => {
      await authorize(tx, projectId);
      let cursor = null;
      if (after) { cursor = await tx.get(projectId, after); if (!cursor) throw denied(); verifyJournalRecord(cursor, orgId, projectId); }
      const rows = await tx.list(projectId, cursor, limit + 1);
      rows.forEach(row => verifyJournalRecord(row, orgId, projectId));
      return { orgId, projectId, observations: rows.slice(0, limit).map(r => ({ id: r.id, recordedAt: r.recordedAt, projectRevision: r.projectRevision,
        recordSha256: r.recordSha256, target: r.observation.target, source: r.observation.source, summary: r.observation.summary, readinessEffect: 'none' })),
        next: rows.length > limit ? rows[limit - 1].id : null };
    });
  }
  async get(principal, orgId, projectId, observationId) {
    orgId = uuid(orgId); projectId = uuid(projectId); observationId = uuid(observationId);
    return this.transaction(principal, orgId, async tx => {
      await authorize(tx, projectId);
      const record = await tx.get(projectId, observationId);
      if (!record) throw denied();
      verifyJournalRecord(record, orgId, projectId);
      const current = await tx.project(projectId);
      if (!current) throw denied();
      return { ...record, currentProjectRevision: current.revision, matchesCurrentRevision: record.projectRevision === current.revision,
        integrity: 'canonical-sha256-checked; not signed or externally attested' };
    });
  }
}
