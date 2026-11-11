import { createHash, randomUUID } from 'node:crypto';
import { createProject, applyCommand, assessProject, reportTemplate } from '../../workflow/src/workflow.mjs';
import { ApiError, denied, object, uuid } from './errors.mjs';

// Explicit allowlist: input cannot replace a project, forge approvals, or supply actor IDs.
const fields = Object.freeze({
  'requirement.add': ['title', 'acceptance', 'owner'],
  'requirement.update': ['id', 'expectedRevision', 'title', 'acceptance', 'owner'],
  'requirement.review': ['id', 'expectedRevision'],
  'design.add': ['title', 'decision', 'owner', 'requirementIds'],
  'design.review': ['id'],
  'build.add': ['label', 'commitSha', 'artifactDigest', 'environment', 'status', 'builtAt', 'sourceUrl'],
  'test.add': ['title', 'requirementId', 'steps', 'expected', 'owner'],
  'test.update': ['id', 'expectedRevision', 'title', 'requirementId', 'steps', 'expected', 'owner'],
  'results.import': ['report'],
  'assessment.create': ['stage', 'buildId', 'environment']
});
const writeRoles = ['OWNER', 'ADMIN', 'CONTRIBUTOR'];
const reviewRoles = ['OWNER', 'ADMIN', 'REVIEWER'];
const roles = [...new Set([...writeRoles, ...reviewRoles, 'VIEWER'])];
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const invalid = message => new ApiError(400, 'INVALID_INPUT', message);
function domain(fn) {
  try { return fn(); } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof TypeError) throw invalid('Invalid command payload.');
    throw invalid(error.message);
  }
}
function scope(principal, orgId) {
  if (!principal || typeof principal.issuer !== 'string' || !principal.issuer || typeof principal.subject !== 'string' || !principal.subject)
    throw new ApiError(401, 'UNAUTHENTICATED', 'A verified access token is required.');
  return { principal: { issuer: principal.issuer, subject: principal.subject }, orgId: uuid(orgId) };
}
function permitted(actor, projectRole, allowed) {
  if (!roles.includes(actor.role) || !allowed.includes(actor.role) || (projectRole !== undefined && !allowed.includes(projectRole)))
    throw new ApiError(403, 'FORBIDDEN', 'Your organization and project roles do not permit this action.');
}
async function access(tx, projectId) {
  const actor = await tx.actor(); // Always load active membership from storage, never token role claims.
  if (!actor || !actor.active || !actor.organizationActive || !actor.userActive) throw denied();
  if (!roles.includes(actor.role)) throw denied();
  if (!projectId) return { actor };
  const membership = await tx.projectMembership(projectId, actor.userId);
  if (!membership?.active || !roles.includes(membership.role)) throw denied();
  return { actor, projectRole: membership.role };
}
export class WorkflowService {
  constructor(repository, { clock = Date.now } = {}) { this.repository = repository; this.clock = clock; }
  async transact(principal, orgId, fn) {
    const context = scope(principal, orgId);
    try { return await this.repository.transaction(context, fn); }
    catch (error) {
      if (error?.code === 'P2034' || error?.code === '40001' || error?.code === '40P01' || error?.code === '23505' || error?.code === 'P2002')
        throw new ApiError(409, 'CONFLICT', 'Concurrent change. Reload, or retry the same request with its original idempotency key.');
      throw error;
    }
  }
  async list(principal, orgId, { after, limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('Limit must be 1–50.');
    if (after) after = uuid(after);
    return this.transact(principal, orgId, async tx => {
      const { actor } = await access(tx);
      const rows = await tx.listProjects(actor.userId, after || null, limit + 1);
      return { projects: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null };
    });
  }
  async get(principal, orgId, projectId) {
    projectId = uuid(projectId);
    return this.transact(principal, orgId, async tx => {
      await access(tx, projectId);
      const project = await tx.getProject(projectId);
      if (!project) throw denied();
      return project;
    });
  }
  async create(principal, orgId, input, requestId) {
    requestId = uuid(requestId);
    object(input, ['name', 'goal', 'owner', 'environment']);
    const fingerprint = hash({ operation: 'project.create', input });
    return this.transact(principal, orgId, async tx => {
      const { actor } = await access(tx);
      permitted(actor, undefined, ['OWNER', 'ADMIN']);
      const prior = await tx.receipt(actor.userId, requestId);
      if (prior) return this.replay(prior, fingerprint);
      if (await tx.projectCount() >= 100) throw new ApiError(409, 'PROJECT_LIMIT', 'This pilot organization is limited to 100 projects.');
      const now = this.clock();
      const project = domain(() => createProject(input, now));
      await tx.insertProject(project, actor.userId);
      const result = { projectId: project.id, revision: project.revision, requestId };
      await tx.audit({ id: randomUUID(), actorId: actor.userId, projectId: project.id, action: 'project.create', requestId, revision: project.revision, requestHash: fingerprint, at: new Date(now).toISOString() });
      await tx.saveReceipt(actor.userId, requestId, fingerprint, result);
      return result;
    });
  }
  replay(prior, fingerprint) {
    if (prior.requestHash !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'That idempotency key was used for a different request.');
    return structuredClone(prior.result);
  }
  async command(principal, orgId, projectId, request, requestId) {
    projectId = uuid(projectId); requestId = uuid(requestId);
    object(request, ['expectedRevision', 'type', 'input']);
    if (!Object.hasOwn(fields, request.type)) throw invalid('Unknown workflow command.');
    object(request.input, fields[request.type]);
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) throw invalid('expectedRevision must be a positive integer.');
    if (bytes(request) > 1_000_000) throw new ApiError(413, 'TOO_LARGE', 'Request exceeds 1 MB.');
    const fingerprint = hash({ projectId, request });
    const review = ['requirement.review', 'design.review', 'assessment.create'].includes(request.type);
    return this.transact(principal, orgId, async tx => {
      const { actor, projectRole } = await access(tx, projectId);
      permitted(actor, projectRole, review ? reviewRoles : writeRoles);
      // Recheck access before any replay: revoked members must not recover prior results.
      const prior = await tx.receipt(actor.userId, requestId);
      if (prior) return this.replay(prior, fingerprint);
      const current = await tx.getProject(projectId, true);
      if (!current) throw denied();
      if (current.revision !== request.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Project changed. Reload before editing.');
      const now = this.clock();
      const next = domain(() => applyCommand(current, { type: request.type, input: request.input }, now));
      // Actor data is server-controlled; an owner label on a record is not a permission.
      const provenance = { actorId: actor.userId, recordedAt: new Date(now).toISOString(), requestId };
      if (request.type === 'requirement.review') next.requirements.find(r => r.id === request.input.id).serverReview = provenance;
      if (request.type === 'design.review') next.designs.find(d => d.id === request.input.id).serverReview = provenance;
      if (request.type === 'assessment.create') {
        const snapshot = next.assessments.at(-1);
        snapshot.serverRecord = provenance;
        // Keep advisory/user-supplied provenance. Persistence does not make CI evidence verified.
        await tx.snapshot(projectId, snapshot, actor.userId);
      }
      if (bytes(next) > 3_000_000) throw new ApiError(413, 'PROJECT_TOO_LARGE', 'Project exceeds the pilot 3 MB limit.');
      await tx.saveProject(next, request.expectedRevision);
      const result = { projectId, revision: next.revision, requestId };
      await tx.audit({ id: randomUUID(), actorId: actor.userId, projectId, action: request.type, requestId, revision: next.revision, requestHash: fingerprint, at: new Date(now).toISOString() });
      await tx.saveReceipt(actor.userId, requestId, fingerprint, result);
      return result;
    });
  }
  async assess(principal, orgId, projectId, target) {
    object(target, ['stage', 'buildId', 'environment']);
    const project = await this.get(principal, orgId, projectId);
    return domain(() => assessProject(project, target, this.clock()));
  }
  async template(principal, orgId, projectId, buildId) {
    const project = await this.get(principal, orgId, projectId);
    return domain(() => reportTemplate(project, buildId, this.clock()));
  }
  async assessment(principal, orgId, projectId, assessmentId) {
    projectId = uuid(projectId);
    if (!/^ASM-\d{3}$/.test(assessmentId)) throw invalid('Invalid assessment ID.');
    return this.transact(principal, orgId, async tx => {
      await access(tx, projectId);
      const snapshot = await tx.getSnapshot(projectId, assessmentId);
      if (!snapshot) throw denied();
      return snapshot;
    });
  }
}
