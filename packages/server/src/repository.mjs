import { ApiError } from './errors.mjs';
/** Prisma-backed repository. Every SQL statement is fixed; untrusted values are bound parameters. */
export class PrismaWorkflowRepository {
  constructor(prisma) { this.prisma = prisma; }
  async assertRuntime() {
    const [role] = await this.prisma.$queryRawUnsafe(`
      SELECT r.rolsuper, r.rolbypassrls,
        pg_has_role(current_user, 'navyix_runtime', 'member') AS member,
        current_setting('row_security') AS security,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'member')) AS owner
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (!role || role.rolsuper || role.rolbypassrls || role.owner || !role.member || role.security !== 'on')
      throw new Error('Business APIs require a non-owner, non-superuser, non-BYPASSRLS member of navyix_runtime with row_security=on.');
    const [migration] = await this.prisma.$queryRawUnsafe(`SELECT count(*)::int AS tables,
      bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS protected
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relkind='r' AND c.relname IN ('User','Organization','Membership','Project','ProjectMembership','WorkflowState','WorkflowCommand','WorkflowSnapshot','AuditEvent')`);
    if (migration?.tables !== 9 || !migration.protected) throw new Error('Workflow database migration or forced RLS is missing.');
  }
  async transaction({ principal, orgId }, operation) {
    return this.prisma.$transaction(async db => {
      const query = (sql, ...values) => db.$queryRawUnsafe(sql, ...values);
      // true = transaction-local; pool reuse must not retain another caller's context.
      await query(`SELECT set_config('navyix.issuer',$1,true), set_config('navyix.subject',$2,true), set_config('navyix.org_id',$3,true)`, principal.issuer, principal.subject, orgId);
      const tx = {
        actor: async () => (await query(`SELECT u.id AS "userId", m.role::text AS role,
          u.active AS "userActive", m.active, o.active AS "organizationActive"
          FROM "User" u JOIN "Membership" m ON m."userId"=u.id JOIN "Organization" o ON o.id=m."orgId"
          WHERE u."oidcIssuer"=$1 AND u."oidcSubject"=$2 AND m."orgId"=$3::uuid
          FOR SHARE OF u,m,o`, principal.issuer, principal.subject, orgId))[0],
        projectMembership: async (projectId, userId) => (await query(`SELECT role::text AS role, active
          FROM "ProjectMembership" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid AND "userId"=$3::uuid FOR SHARE`, orgId, projectId, userId))[0],
        listProjects: async (userId, after, limit) => query(`SELECT p.id,p.name,s.revision,s.data->>'updatedAt' AS "updatedAt"
          FROM "Project" p JOIN "WorkflowState" s ON s."orgId"=p."orgId" AND s."projectId"=p.id
          JOIN "ProjectMembership" m ON m."orgId"=p."orgId" AND m."projectId"=p.id
          WHERE p."orgId"=$1::uuid AND m."userId"=$2::uuid AND m.active AND ($3::uuid IS NULL OR p.id>$3::uuid)
          ORDER BY p.id LIMIT $4::int`, orgId, userId, after, limit),
        projectCount: async () => Number((await query(`SELECT count(*)::int AS count FROM "Project" WHERE "orgId"=$1::uuid`, orgId))[0].count),
        getProject: async (projectId, lock = false) => (await query(lock
          ? `SELECT data FROM "WorkflowState" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid FOR UPDATE`
          : `SELECT data FROM "WorkflowState" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid`, orgId, projectId))[0]?.data,
        insertProject: async (project, userId) => {
          await query(`INSERT INTO "Project" (id,"orgId",name,key,"createdAt") VALUES ($1::uuid,$2::uuid,$3,$4,$5::timestamptz) RETURNING id`, project.id, orgId, project.name, project.id, project.createdAt);
          await query(`INSERT INTO "ProjectMembership" ("orgId","projectId","userId",role,active)
            VALUES ($1::uuid,$2::uuid,$3::uuid,'OWNER',true) RETURNING "projectId"`, orgId, project.id, userId);
          await query(`INSERT INTO "WorkflowState" ("orgId","projectId",revision,data)
            VALUES ($1::uuid,$2::uuid,$3::int,$4::jsonb) RETURNING "projectId"`, orgId, project.id, project.revision, JSON.stringify(project));
        },
        saveProject: async (project, expectedRevision) => {
          const rows = await query(`UPDATE "WorkflowState" SET revision=$3::int,data=$4::jsonb
            WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid AND revision=$5::int RETURNING "projectId"`, orgId, project.id, project.revision, JSON.stringify(project), expectedRevision);
          if (rows.length !== 1) throw new ApiError(409, 'REVISION_CONFLICT', 'Project changed. Reload before editing.');
        },
        receipt: async (actorId, requestId) => (await query(`SELECT "requestHash",result FROM "WorkflowCommand"
          WHERE "orgId"=$1::uuid AND "actorId"=$2::uuid AND "requestId"=$3::uuid`, orgId, actorId, requestId))[0],
        saveReceipt: async (actorId, requestId, requestHash, result) => query(`INSERT INTO "WorkflowCommand"
          ("orgId","actorId","requestId","requestHash",result) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb) RETURNING "requestId"`, orgId, actorId, requestId, requestHash, JSON.stringify(result)),
        audit: async event => db.$executeRawUnsafe(`INSERT INTO "AuditEvent" (id,"orgId","actorId",action,"entityType","entityId",metadata,"createdAt")
          VALUES ($1::uuid,$2::uuid,$3,$4,'Project',$5,$6::jsonb,$7::timestamptz)`, event.id, orgId, event.actorId, event.action, event.projectId,
          JSON.stringify({ requestId: event.requestId, revision: event.revision, requestHash: event.requestHash }), event.at),
        snapshot: async (projectId, snapshot, actorId) => query(`INSERT INTO "WorkflowSnapshot" ("orgId","projectId",id,"actorId",data)
          VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb) RETURNING id`, orgId, projectId, snapshot.id, actorId, JSON.stringify(snapshot)),
        getSnapshot: async (projectId, id) => (await query(`SELECT data FROM "WorkflowSnapshot" WHERE "orgId"=$1::uuid AND "projectId"=$2::uuid AND id=$3`, orgId, projectId, id))[0]?.data
      };
      return operation(tx);
    }, { isolationLevel: 'Serializable', maxWait: 3000, timeout: 10000 });
  }
}
