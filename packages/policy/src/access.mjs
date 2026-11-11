/**
 * Pure authorization decisions. Caller MUST obtain membership from a trusted
 * server-side identity and tenant-scoped database lookup; never from client input.
 * This module is not an authentication implementation.
 */
const permissions = Object.freeze({
  OWNER: ['org:read','org:manage','member:manage','project:read','project:write','evidence:read','assessment:review','policy:manage','ai:grant'],
  ADMIN: ['org:read','member:manage','project:read','project:write','evidence:read','assessment:review','policy:manage','ai:grant'],
  CONTRIBUTOR: ['org:read','project:read','project:write','evidence:read'],
  REVIEWER: ['org:read','project:read','evidence:read','assessment:review'],
  VIEWER: ['org:read','project:read','evidence:read']
});
export const ROLES = Object.freeze(Object.keys(permissions));
export const ACTIONS = Object.freeze([...new Set(Object.values(permissions).flat())]);

/** Fail closed for missing/invalid identities, memberships, and project scope. */
export function canAccess({ principal, membership, action, orgId, projectId, projectMembership } = {}) {
  if (!principal?.id || !membership || !orgId || !ACTIONS.includes(action)) return false;
  if (membership.active !== true || membership.userId !== principal.id || membership.orgId !== orgId) return false;
  if (!permissions[membership.role]?.includes(action)) return false;
  if (projectId !== undefined) {
    if (!projectId || !projectMembership || projectMembership.active !== true) return false;
    if (projectMembership.userId !== principal.id || projectMembership.orgId !== orgId || projectMembership.projectId !== projectId) return false;
  }
  return true;
}
