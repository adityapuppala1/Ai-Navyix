// Test double ONLY. Never exported by the server package or used by API bootstrap.
import { ApiError } from '../../src/errors.mjs';
export const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OWNER = { issuer: 'https://issuer.example', subject: 'owner-a' };
export const OTHER = { issuer: 'https://issuer.example', subject: 'owner-b' };
export const identity = principal => `${principal.issuer}|${principal.subject}`;
export class MemoryRepository {
  constructor() {
    this.data = { actors: {}, memberships: {}, projects: {}, receipts: {}, snapshots: {}, audits: [] };
    this.queue = Promise.resolve(); this.failAt = null;
    this.addActor(A, OWNER, 'OWNER'); this.addActor(B, OTHER, 'OWNER');
  }
  addActor(orgId, principal, role, overrides = {}) {
    const actor = { userId: globalThis.crypto.randomUUID(), role, active: true, userActive: true, organizationActive: true, ...overrides };
    this.data.actors[`${orgId}|${identity(principal)}`] = actor; return actor;
  }
  grant(orgId, projectId, principal, role, active = true) {
    const actor = this.data.actors[`${orgId}|${identity(principal)}`];
    this.data.memberships[`${orgId}|${projectId}|${actor.userId}`] = { active, role };
  }
  async transaction({ principal, orgId }, operation) {
    const run = this.queue.then(async () => {
      const state = structuredClone(this.data), key = id => `${orgId}|${id}`;
      const fail = at => { if (this.failAt === at) throw new Error(`Injected ${at} failure`); };
      const tx = {
        actor: async () => state.actors[`${orgId}|${identity(principal)}`],
        projectMembership: async (projectId, userId) => state.memberships[`${orgId}|${projectId}|${userId}`],
        projectCount: async () => Object.keys(state.projects).filter(k => k.startsWith(`${orgId}|`)).length,
        listProjects: async (userId, after, limit) => Object.entries(state.projects).filter(([k, p]) => k.startsWith(`${orgId}|`) && (!after || p.id > after) && state.memberships[`${orgId}|${p.id}|${userId}`]?.active)
          .map(([, p]) => ({ id: p.id, name: p.name, revision: p.revision, updatedAt: p.updatedAt })).sort((a,b) => a.id.localeCompare(b.id)).slice(0,limit),
        insertProject: async (p, userId) => { state.projects[key(p.id)] = structuredClone(p); state.memberships[`${orgId}|${p.id}|${userId}`] = { role: 'OWNER', active: true }; },
        getProject: async id => structuredClone(state.projects[key(id)]),
        saveProject: async (p, expected) => { fail('save'); if (state.projects[key(p.id)].revision !== expected) throw new ApiError(409,'REVISION_CONFLICT','Changed'); state.projects[key(p.id)] = structuredClone(p); },
        receipt: async (actorId, id) => state.receipts[`${orgId}|${actorId}|${id}`],
        saveReceipt: async (actorId, id, requestHash, result) => { fail('receipt'); state.receipts[`${orgId}|${actorId}|${id}`] = { requestHash, result: structuredClone(result) }; },
        audit: async event => { fail('audit'); state.audits.push({ orgId, ...structuredClone(event) }); },
        snapshot: async (projectId, snap) => { fail('snapshot'); state.snapshots[`${orgId}|${projectId}|${snap.id}`] = structuredClone(snap); },
        getSnapshot: async (projectId, id) => structuredClone(state.snapshots[`${orgId}|${projectId}|${id}`])
      };
      const result = await operation(tx); this.data = state; return structuredClone(result);
    });
    this.queue = run.catch(() => {}); return run;
  }
}
