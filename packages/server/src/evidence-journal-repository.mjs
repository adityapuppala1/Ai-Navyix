/** Fixed SQL and transaction-local identity. Runtime credentials never own tables or bypass RLS. */
export class PrismaEvidenceJournalRepository {
  constructor(prisma) { this.prisma = prisma; }
  async assertRuntime() {
    const [role] = await this.prisma.$queryRawUnsafe(`SELECT r.rolsuper,r.rolbypassrls,
      pg_has_role(current_user,'navyix_runtime','member') AS member,
      current_setting('row_security') AS security,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'member')) AS owner
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (!role || role.rolsuper || role.rolbypassrls || role.owner || !role.member || role.security !== 'on') throw new Error('Evidence journal requires restricted runtime credentials.');
    const [table] = await this.prisma.$queryRawUnsafe(`SELECT c.relrowsecurity AND c.relforcerowsecurity AS protected,
      has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AS readable,
      has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') AS mutable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='GitHubObservation' AND c.relkind='r'`);
    if (!table?.protected || !table.readable || table.mutable) throw new Error('Evidence journal migration or restricted grants are missing.');
  }
  async transaction({ principal, orgId }, operation) {
    return this.prisma.$transaction(async db => {
      const query = (sql, ...values) => db.$queryRawUnsafe(sql, ...values);
      await query(`SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),set_config('navyix.org_id',$3,true)`, principal.issuer, principal.subject, orgId);
      const row = value => value ? { ...value, recordedAt: new Date(value.recordedAt).toISOString() } : null;
      const tx = {
        actor: async () => (await query(`SELECT u.id AS "userId",m.role::text AS role,u.active AS "userActive",m.active,o.active AS "organizationActive"
          FROM public."User" u JOIN public."Membership" m ON m."userId"=u.id JOIN public."Organization" o ON o.id=m."orgId"
          WHERE u."oidcIssuer"=$1 AND u."oidcSubject"=$2 AND m."orgId"=$3::uuid FOR SHARE OF u,m,o`, principal.issuer, principal.subject, orgId))[0],
        projectMembership: async (projectId, userId) => (await query(`SELECT role::text AS role,active FROM public."ProjectMembership"
          WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid AND "userId"=$3::uuid FOR SHARE`, orgId, projectId, userId))[0],
        project: async (projectId, lock = false) => (await query(lock
          ? `SELECT data FROM public."WorkflowState" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid FOR UPDATE`
          : `SELECT data FROM public."WorkflowState" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid`, orgId, projectId))[0]?.data,
        count: async projectId => (await query(`SELECT count(*)::int AS count FROM public."GitHubObservation" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid`, orgId, projectId))[0].count,
        receipt: async (actorId, requestId) => (await query(`SELECT "requestHash",result FROM public."WorkflowCommand"
          WHERE "orgId"=$1::uuid AND "actorId"=$2::uuid AND "requestId"=$3::uuid`, orgId, actorId, requestId))[0],
        saveReceipt: async (actorId, requestId, fingerprint, result) => query(`INSERT INTO public."WorkflowCommand"
          ("orgId","actorId","requestId","requestHash",result) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb) RETURNING "requestId"`, orgId, actorId, requestId, fingerprint, JSON.stringify(result)),
        insert: async r => query(`INSERT INTO public."GitHubObservation"
          (id,"orgId","projectId","actorId","requestId","projectRevision","recordedAt","recordSha256",observation)
          VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::int,$7::timestamptz,$8,$9::jsonb) RETURNING id`,
          r.id, orgId, r.projectId, r.actorId, r.requestId, r.projectRevision, r.recordedAt, r.recordSha256, JSON.stringify(r.observation)),
        audit: async (r, fingerprint) => db.$executeRawUnsafe(`INSERT INTO public."AuditEvent"
          (id,"orgId","actorId",action,"entityType","entityId",metadata,"createdAt")
          VALUES ($1::uuid,$2::uuid,$3,'github.observation.capture','GitHubObservation',$4,$5::jsonb,$6::timestamptz)`,
          r.id, orgId, r.actorId, r.id, JSON.stringify({ projectId: r.projectId, projectRevision: r.projectRevision, requestId: r.requestId, requestHash: fingerprint, recordSha256: r.recordSha256 }), r.recordedAt),
        get: async (projectId, id) => row((await query(`SELECT * FROM public."GitHubObservation"
          WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid AND id=$3::uuid`, orgId, projectId, id))[0]),
        list: async (projectId, cursor, limit) => (await query(`SELECT * FROM public."GitHubObservation"
          WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid AND ($3::timestamptz IS NULL OR ("recordedAt",id)<($3::timestamptz,$4::uuid))
          ORDER BY "recordedAt" DESC,id DESC LIMIT $5::int`, orgId, projectId, cursor?.recordedAt ?? null, cursor?.id ?? null, limit)).map(row)
      };
      return operation(tx);
    }, { isolationLevel: 'Serializable', maxWait: 3000, timeout: 10000 });
  }
}
