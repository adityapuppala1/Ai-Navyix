import { ApiError } from './errors.mjs';
const conflict = error => ['P2034','P2002','40001','40P01','23505'].includes(error?.code) || (error?.code === 'P2010' && ['40001','40P01','23505'].includes(error.meta?.code));
export class PrismaInvitationRepository {
  constructor(prisma) { this.prisma = prisma; }
  async assertRuntime() {
    const [r] = await this.prisma.$queryRawUnsafe(`SELECT
      NOT r.rolsuper AND NOT r.rolbypassrls AND current_setting('row_security')='on'
      AND pg_has_role(current_user,'navyix_runtime','member') AS safe,
      NOT pg_has_role(current_user,'navyix_invitation_executor','member') AS isolated,
      NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relkind='r' AND pg_has_role(current_user,c.relowner,'member')) AS nonowner,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='navyix_invitations' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) AS tables,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles o ON o.oid=p.proowner
        WHERE n.nspname='navyix_invitations' AND p.proname='execute' AND p.prosecdef
        AND o.rolname='navyix_invitation_executor' AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcanlogin
        AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on']) AS guarded
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (!r?.safe || !r.isolated || !r.nonowner || r.tables !== 2 || !r.guarded) throw new Error('Invitation migration or restricted function owner is unavailable.');
  }
  async execute(principal, command, orgId, payload, requestId) {
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe(`SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),
          set_config('navyix.org_id',$3,true),set_config('navyix.invitation_email',$4,true)`, principal.issuer, principal.subject, orgId || '', principal.email || '');
        const [row] = await tx.$queryRawUnsafe('SELECT navyix_invitations.execute($1,$2::uuid,$3::jsonb,$4::uuid) AS result', command, orgId, JSON.stringify(payload), requestId);
        if (!row?.result || typeof row.result !== 'object') throw new Error('Invalid invitation response.');
        return row.result;
      }, { isolationLevel: 'Serializable', maxWait: 3000, timeout: 10000 });
    } catch (error) {
      const code = error?.code === 'P2010' ? error.meta?.code : error?.code;
      if (code === '42501' || code === 'P0002') throw new ApiError(404, 'INVITATION_UNAVAILABLE', 'Invitation or organization access is unavailable.');
      if (code === '22023') throw new ApiError(400, 'INVALID_INPUT', 'Invitation input is invalid.');
      if (conflict(error)) throw new ApiError(409, 'INVITATION_CONFLICT', 'Invitation changed or already exists. Refresh before continuing.');
      if (code === '54000') throw new ApiError(409, 'INVITATION_LIMIT', 'This organization has reached the pilot invitation limit.');
      throw error;
    }
  }
}
