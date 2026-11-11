-- Initial migration for an EMPTY development database; never reset an existing database.

-- Review and run prisma validate + live RLS tests before enabling customer traffic.

-- Apply roles.sql first with an administrative database identity.

CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'CONTRIBUTOR', 'REVIEWER', 'VIEWER');

CREATE TYPE "EvidenceState" AS ENUM ('CURRENT', 'STALE', 'REVOKED');

CREATE TYPE "GrantState" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE "User" (
  "id" UUID NOT NULL PRIMARY KEY,
  "oidcIssuer" TEXT NOT NULL,
  "oidcSubject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Organization" (
  "id" UUID NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Membership" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "Project" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProjectMembership" (
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ProjectMembership_orgId_projectId_userId_pkey" PRIMARY KEY ("orgId","projectId","userId")
);

CREATE TABLE "WorkflowState" (
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  CONSTRAINT "WorkflowState_orgId_projectId_pkey" PRIMARY KEY ("orgId","projectId")
);

CREATE TABLE "WorkflowCommand" (
  "orgId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "requestHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowCommand_orgId_actorId_requestId_pkey" PRIMARY KEY ("orgId","actorId","requestId")
);

CREATE TABLE "WorkflowSnapshot" (
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "id" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowSnapshot_orgId_projectId_id_pkey" PRIMARY KEY ("orgId","projectId","id")
);

CREATE TABLE "Requirement" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "externalKey" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "RequirementVersion" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "acceptance" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Artifact" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "digest" TEXT NOT NULL,
  "commitSha" TEXT,
  "environment" TEXT NOT NULL,
  "collectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Evidence" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "objectKey" TEXT,
  "state" "EvidenceState" NOT NULL DEFAULT 'CURRENT',
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "collectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PolicyVersion" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "rules" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Assessment" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "targetDigest" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "policyVersionId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "criterionResult" JSONB NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AiSourceGrant" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "scope" JSONB NOT NULL,
  "purposes" JSONB NOT NULL,
  "provider" TEXT NOT NULL,
  "state" "GrantState" NOT NULL DEFAULT 'ACTIVE',
  "validUntil" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User" ("oidcIssuer","oidcSubject");

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization" ("slug");

CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership" ("orgId","userId");

CREATE INDEX "Membership_userId_orgId_idx" ON "Membership" ("userId","orgId");

CREATE UNIQUE INDEX "Project_orgId_key_key" ON "Project" ("orgId","key");

CREATE UNIQUE INDEX "Project_orgId_id_key" ON "Project" ("orgId","id");

CREATE UNIQUE INDEX "Requirement_orgId_projectId_externalKey_key" ON "Requirement" ("orgId","projectId","externalKey");

CREATE UNIQUE INDEX "Requirement_orgId_id_key" ON "Requirement" ("orgId","id");

CREATE UNIQUE INDEX "RequirementVersion_orgId_requirementId_version_key" ON "RequirementVersion" ("orgId","requirementId","version");

CREATE UNIQUE INDEX "Artifact_orgId_projectId_digest_environment_key" ON "Artifact" ("orgId","projectId","digest","environment");

CREATE UNIQUE INDEX "Artifact_orgId_id_key" ON "Artifact" ("orgId","id");

CREATE UNIQUE INDEX "Evidence_orgId_source_sourceRef_digest_key" ON "Evidence" ("orgId","source","sourceRef","digest");

CREATE UNIQUE INDEX "Evidence_orgId_id_key" ON "Evidence" ("orgId","id");

CREATE INDEX "Evidence_orgId_projectId_state_idx" ON "Evidence" ("orgId","projectId","state");

CREATE UNIQUE INDEX "PolicyVersion_orgId_projectId_version_key" ON "PolicyVersion" ("orgId","projectId","version");

CREATE UNIQUE INDEX "PolicyVersion_orgId_id_key" ON "PolicyVersion" ("orgId","id");

CREATE INDEX "Assessment_orgId_projectId_evaluatedAt_idx" ON "Assessment" ("orgId","projectId","evaluatedAt");

CREATE INDEX "AiSourceGrant_orgId_state_idx" ON "AiSourceGrant" ("orgId","state");

CREATE INDEX "AuditEvent_orgId_createdAt_idx" ON "AuditEvent" ("orgId","createdAt");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_orgId_userId_fkey" FOREIGN KEY ("orgId","userId") REFERENCES "Membership" ("orgId","userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowState" ADD CONSTRAINT "WorkflowState_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowCommand" ADD CONSTRAINT "WorkflowCommand_orgId_actorId_fkey" FOREIGN KEY ("orgId","actorId") REFERENCES "Membership" ("orgId","userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowSnapshot" ADD CONSTRAINT "WorkflowSnapshot_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowSnapshot" ADD CONSTRAINT "WorkflowSnapshot_orgId_actorId_fkey" FOREIGN KEY ("orgId","actorId") REFERENCES "Membership" ("orgId","userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_orgId_requirementId_fkey" FOREIGN KEY ("orgId","requirementId") REFERENCES "Requirement" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES "Project" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_orgId_policyVersionId_fkey" FOREIGN KEY ("orgId","policyVersionId") REFERENCES "PolicyVersion" ("orgId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiSourceGrant" ADD CONSTRAINT "AiSourceGrant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowState" ADD CONSTRAINT "workflow_shape" CHECK (
  revision > 0 AND jsonb_typeof(data->'id')='string' AND jsonb_typeof(data->'revision')='number' AND jsonb_typeof(data) = 'object' AND data->>'id'="projectId"::text
  AND (data->>'revision')::integer=revision AND octet_length(data::text)<=3500000);
ALTER TABLE "WorkflowCommand" ADD CONSTRAINT "command_hash" CHECK ("requestHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "WorkflowSnapshot" ADD CONSTRAINT "snapshot_shape" CHECK (
  jsonb_typeof(data->'id')='string' AND jsonb_typeof(data->'projectId')='string' AND jsonb_typeof(data->'advisory')='boolean' AND data->>'id'=id AND data->>'projectId'="projectId"::text AND data->>'advisory'='true');

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "User" FROM PUBLIC;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Organization" FROM PUBLIC;

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Membership" FROM PUBLIC;

ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Project" FROM PUBLIC;

ALTER TABLE "ProjectMembership" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ProjectMembership" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "ProjectMembership" FROM PUBLIC;

ALTER TABLE "WorkflowState" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "WorkflowState" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "WorkflowState" FROM PUBLIC;

ALTER TABLE "WorkflowCommand" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "WorkflowCommand" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "WorkflowCommand" FROM PUBLIC;

ALTER TABLE "WorkflowSnapshot" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "WorkflowSnapshot" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "WorkflowSnapshot" FROM PUBLIC;

ALTER TABLE "Requirement" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Requirement" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Requirement" FROM PUBLIC;

ALTER TABLE "RequirementVersion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "RequirementVersion" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "RequirementVersion" FROM PUBLIC;

ALTER TABLE "Artifact" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Artifact" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Artifact" FROM PUBLIC;

ALTER TABLE "Evidence" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Evidence" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Evidence" FROM PUBLIC;

ALTER TABLE "PolicyVersion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PolicyVersion" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "PolicyVersion" FROM PUBLIC;

ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Assessment" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "Assessment" FROM PUBLIC;

ALTER TABLE "AiSourceGrant" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AiSourceGrant" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "AiSourceGrant" FROM PUBLIC;

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "AuditEvent" FROM PUBLIC;

-- Invoker-only helpers: no SECURITY DEFINER bypass and no recursive membership policy.
CREATE FUNCTION public.navyix_actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
  SELECT id FROM public."User" WHERE "oidcIssuer"=current_setting('navyix.issuer',true)
    AND "oidcSubject"=current_setting('navyix.subject',true) AND active
$$;
CREATE FUNCTION public.navyix_active_member() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public."Membership" m JOIN public."Organization" o ON o.id=m."orgId"
    WHERE m."orgId"::text=current_setting('navyix.org_id',true) AND m."userId"=public.navyix_actor_id() AND m.active AND o.active)
$$;
CREATE FUNCTION public.navyix_org_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public."Membership" m WHERE m."orgId"::text=current_setting('navyix.org_id',true)
    AND m."userId"=public.navyix_actor_id() AND m.active AND m.role IN ('OWNER','ADMIN'))
$$;
REVOKE ALL ON FUNCTION public.navyix_actor_id(), public.navyix_active_member(), public.navyix_org_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.navyix_actor_id(), public.navyix_active_member(), public.navyix_org_admin() TO navyix_runtime;

CREATE POLICY "User_select" ON "User" FOR SELECT TO navyix_runtime USING ("oidcIssuer"=current_setting('navyix.issuer',true) AND "oidcSubject"=current_setting('navyix.subject',true) AND active);

CREATE POLICY "Organization_select" ON "Organization" FOR SELECT TO navyix_runtime USING (id::text=current_setting('navyix.org_id',true) AND active);

CREATE POLICY "Membership_select" ON "Membership" FOR SELECT TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND "userId"=public.navyix_actor_id() AND active);

CREATE POLICY "ProjectMembership_select" ON "ProjectMembership" FOR SELECT TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND "userId"=public.navyix_actor_id() AND active);

CREATE POLICY "User_update" ON "User" FOR UPDATE TO navyix_runtime USING ("oidcIssuer"=current_setting('navyix.issuer',true) AND "oidcSubject"=current_setting('navyix.subject',true) AND active) WITH CHECK (false);

CREATE POLICY "Organization_update" ON "Organization" FOR UPDATE TO navyix_runtime USING (id::text=current_setting('navyix.org_id',true) AND active) WITH CHECK (false);

CREATE POLICY "Membership_update" ON "Membership" FOR UPDATE TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND "userId"=public.navyix_actor_id() AND active) WITH CHECK (false);

CREATE POLICY "ProjectMembership_update" ON "ProjectMembership" FOR UPDATE TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND "userId"=public.navyix_actor_id() AND active) WITH CHECK (false);

CREATE POLICY "ProjectMembership_insert" ON "ProjectMembership" FOR INSERT TO navyix_runtime WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND "userId"=public.navyix_actor_id() AND public.navyix_active_member() AND public.navyix_org_admin());

CREATE POLICY "Project_select" ON "Project" FOR SELECT TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND (public.navyix_org_admin() OR EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="Project"."orgId" AND pm."projectId"="Project".id AND pm."userId"=public.navyix_actor_id() AND pm.active)));

CREATE POLICY "Project_insert" ON "Project" FOR INSERT TO navyix_runtime WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND public.navyix_org_admin());

CREATE POLICY "WorkflowState_select" ON "WorkflowState" FOR SELECT TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="WorkflowState"."orgId" AND pm."projectId"="WorkflowState"."projectId" AND pm."userId"=public.navyix_actor_id() AND pm.active));

CREATE POLICY "WorkflowState_insert" ON "WorkflowState" FOR INSERT TO navyix_runtime WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="WorkflowState"."orgId" AND pm."projectId"="WorkflowState"."projectId" AND pm."userId"=public.navyix_actor_id() AND pm.active));

CREATE POLICY "WorkflowState_update" ON "WorkflowState" FOR UPDATE TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="WorkflowState"."orgId" AND pm."projectId"="WorkflowState"."projectId" AND pm."userId"=public.navyix_actor_id() AND pm.active)) WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="WorkflowState"."orgId" AND pm."projectId"="WorkflowState"."projectId" AND pm."userId"=public.navyix_actor_id() AND pm.active));

CREATE POLICY "WorkflowCommand_select" ON "WorkflowCommand" FOR SELECT TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND "actorId"=public.navyix_actor_id());

CREATE POLICY "WorkflowCommand_insert" ON "WorkflowCommand" FOR INSERT TO navyix_runtime WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND "actorId"=public.navyix_actor_id());

CREATE POLICY "WorkflowSnapshot_select" ON "WorkflowSnapshot" FOR SELECT TO navyix_runtime USING ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="WorkflowSnapshot"."orgId" AND pm."projectId"="WorkflowSnapshot"."projectId" AND pm."userId"=public.navyix_actor_id() AND pm.active));

CREATE POLICY "WorkflowSnapshot_insert" ON "WorkflowSnapshot" FOR INSERT TO navyix_runtime WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND EXISTS (SELECT 1 FROM "ProjectMembership" pm WHERE pm."orgId"="WorkflowSnapshot"."orgId" AND pm."projectId"="WorkflowSnapshot"."projectId" AND pm."userId"=public.navyix_actor_id() AND pm.active) AND "actorId"=public.navyix_actor_id());

CREATE POLICY "AuditEvent_insert" ON "AuditEvent" FOR INSERT TO navyix_runtime WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND "actorId"=public.navyix_actor_id()::text);

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO navyix_runtime;

GRANT SELECT ON "User","Organization","Membership","ProjectMembership","Project","WorkflowState","WorkflowCommand","WorkflowSnapshot" TO navyix_runtime;

GRANT UPDATE (active) ON "User","Organization","Membership","ProjectMembership" TO navyix_runtime;

GRANT INSERT ON "Project","ProjectMembership","WorkflowState","WorkflowCommand","WorkflowSnapshot","AuditEvent" TO navyix_runtime;

GRANT UPDATE ON "WorkflowState" TO navyix_runtime;

-- No runtime UPDATE/DELETE/TRUNCATE privileges on audit, commands or snapshots. Unused draft tables have no runtime grants/policies.
