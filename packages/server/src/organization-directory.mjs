import { ApiError, object, uuid } from './errors.mjs';

const ROLES = new Set(['OWNER', 'ADMIN', 'CONTRIBUTOR', 'REVIEWER', 'VIEWER']);
const invalid = message => new ApiError(400, 'INVALID_INPUT', message);
function identity(value) {
  if (!value || typeof value.issuer !== 'string' || !value.issuer || value.issuer.length > 2048 ||
      typeof value.subject !== 'string' || !value.subject || value.subject.length > 255) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A verified access token is required.');
  }
  // Only the trusted authenticator supplies these fields. Role/email claims are never used.
  return { issuer: value.issuer, subject: value.subject };
}
export class OrganizationDirectoryService {
  constructor(repository) { this.repository = repository; }
  async list(principal, options = {}) {
    const actor = identity(principal);
    object(options, ['after', 'limit']);
    const limit = options.limit === undefined ? 20 : options.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw invalid('Limit must be 1–50.');
    const after = options.after === undefined ? null : uuid(options.after);
    const rows = await this.repository.list(actor, after, limit + 1);
    if (!Array.isArray(rows) || rows.length > limit + 1) throw new Error('Invalid organization directory result.');
    let previous = after;
    const organizations = rows.map(row => {
      let id;
      try { id = uuid(row?.id); } catch { throw new Error('Invalid organization directory result.'); }
      if (id !== row.id || (previous && id <= previous) || typeof row.name !== 'string' ||
          !row.name.trim() || row.name.length > 200 || !ROLES.has(row.role)) throw new Error('Invalid organization directory result.');
      previous = id;
      // Never return users, emails, provider identifiers, member counts or full DB records.
      return { id, name: row.name, role: row.role };
    });
    return { organizations: organizations.slice(0, limit), next: organizations.length > limit ? organizations[limit - 1].id : null };
  }
}

/** Current caller's memberships only; no org ID, user ID or claim-supplied role input. */
export class PrismaOrganizationDirectory {
  constructor(prisma) { this.prisma = prisma; }
  async assertRuntime() {
    const [state] = await this.prisma.$queryRawUnsafe(`SELECT
      NOT r.rolsuper AND NOT r.rolbypassrls AND pg_has_role(current_user,'navyix_runtime','member')
        AND current_setting('row_security')='on' AS safe,
      NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'member')) AS nonowner,
      (SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND p.polcmd='r'
        AND c.relrowsecurity AND c.relforcerowsecurity AND
        ((c.relname='Membership' AND p.polname='Membership_personal_directory') OR
         (c.relname='Organization' AND p.polname='Organization_personal_directory'))) AS policies
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (!state?.safe || !state.nonowner || state.policies !== 2) throw new Error('Restricted organization-directory role or migration is missing.');
  }
  async list(principal, after, limit) {
    return this.prisma.$transaction(async db => {
      // No writes or session-scoped tenant context. All GUC values expire with the transaction.
      await db.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await db.$queryRawUnsafe(`SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),
        set_config('navyix.org_id','',true),set_config('navyix.personal_directory','true',true)`, principal.issuer, principal.subject);
      return db.$queryRawUnsafe(`SELECT o.id,o.name,m.role::text AS role
        FROM public."User" u JOIN public."Membership" m ON m."userId"=u.id
        JOIN public."Organization" o ON o.id=m."orgId"
        WHERE u."oidcIssuer"=$1 AND u."oidcSubject"=$2 AND u.active AND m.active AND o.active
          AND ($3::uuid IS NULL OR o.id>$3::uuid)
        ORDER BY o.id LIMIT $4::int`, principal.issuer, principal.subject, after, limit);
    }, { isolationLevel: 'ReadCommitted', maxWait: 3000, timeout: 5000 });
  }
}
