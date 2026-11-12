import { createHash } from 'node:crypto';
import { ApiError, object, uuid } from './errors.mjs';
import { isTransactionConflict } from './transaction-errors.mjs';

const ROLES = ['ADMIN', 'CONTRIBUTOR', 'REVIEWER', 'VIEWER'];
const invalid = message => new ApiError(400, 'INVALID_INPUT', message);
function scope(principal, orgId, projectId) {
  if (!principal || typeof principal.issuer !== 'string' || !principal.issuer || typeof principal.subject !== 'string' || !principal.subject)
    throw new ApiError(401, 'UNAUTHENTICATED', 'A verified access token is required.');
  return { principal: { issuer: principal.issuer, subject: principal.subject }, orgId: uuid(orgId), projectId: uuid(projectId) };
}
/** Existing members only. Database functions re-authorize every list/write/replay. */
export class TeamService {
  constructor(repository) { this.repository = repository; }
  async transact(context, fn) {
    try { return await this.repository.transaction(context, fn); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      const code = error?.code === 'P2010' ? error.meta?.code : error?.code;
      if (code === '42501') throw new ApiError(404, 'NOT_FOUND', 'Project access management is unavailable for this account.');
      if (code === '22023') throw invalid('This role, member, or access change is not permitted. Reload the directory.');
      if (isTransactionConflict(error)) throw new ApiError(409, 'CONFLICT', 'Membership changed or the request ID was reused. Reload; retry uncertain saves with the original request ID.');
      throw error;
    }
  }
  async list(principal, orgId, projectId, input = {}) {
    const context = scope(principal, orgId, projectId);
    object(input, ['after', 'limit']);
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('Limit must be 1–50.');
    const after = input.after ? uuid(input.after) : null;
    return this.transact(context, tx => tx.directory(after, limit));
  }
  async change(principal, orgId, projectId, input, requestId) {
    const context = scope(principal, orgId, projectId);
    requestId = uuid(requestId);
    object(input, ['userId', 'role', 'active', 'expectedRevision']);
    const userId = uuid(input.userId);
    if (!ROLES.includes(input.role) || typeof input.active !== 'boolean') throw invalid('Use an allowed project role and a boolean active state.');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646) throw invalid('expectedRevision must be a nonnegative membership revision.');
    const command = { userId, role: input.role, active: input.active, expectedRevision: input.expectedRevision };
    const requestHash = createHash('sha256').update(JSON.stringify({ operation: 'project.member.set', orgId: context.orgId, projectId: context.projectId, command })).digest('hex');
    return this.transact(context, tx => tx.change(command, requestId, requestHash));
  }
}

/** No owner connection or SQL interpolation. Runtime receives only two function grants. */
export class PrismaTeamRepository {
  constructor(prisma) { this.prisma = prisma; }
  async assertRuntime() {
    const rows = await this.prisma.$queryRawUnsafe(`SELECT r.rolsuper, r.rolbypassrls, r.rolcanlogin,
      pg_has_role(current_user,r.oid,'MEMBER') AS inherited,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='navyix_team' AND p.proname IN ('directory','change_member')
       AND p.proowner=r.oid AND p.prosecdef AND 'search_path=pg_catalog'=ANY(p.proconfig)
       AND 'row_security=on'=ANY(p.proconfig)) AS functions
      FROM pg_roles r WHERE r.rolname='navyix_team_executor'`);
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.rolcanlogin || role.inherited || role.functions !== 2)
      throw new Error('Project team migration and restricted function owner are required.');
  }
  async transaction({ principal, orgId, projectId }, operation) {
    return this.prisma.$transaction(async db => {
      const query = (sql, ...values) => db.$queryRawUnsafe(sql, ...values);
      await query(`SELECT set_config('navyix.issuer',$1,true), set_config('navyix.subject',$2,true), set_config('navyix.org_id',$3,true)`, principal.issuer, principal.subject, orgId);
      return operation({
        directory: async (after, limit) => (await query(`SELECT navyix_team.directory($1::uuid,$2::uuid,$3::int) AS data`, projectId, after, limit))[0].data,
        change: async (command, requestId, requestHash) => (await query(`SELECT navyix_team.change_member($1::uuid,$2::uuid,$3::text,$4::boolean,$5::int,$6::uuid,$7::text) AS data`,
          projectId, command.userId, command.role, command.active, command.expectedRevision, requestId, requestHash))[0].data
      });
    }, { isolationLevel: 'Serializable', maxWait: 3000, timeout: 10000 });
  }
}
