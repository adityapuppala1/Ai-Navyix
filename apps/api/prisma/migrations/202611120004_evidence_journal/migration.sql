-- Additive migration. No migration is applied automatically by application startup.
BEGIN;
CREATE TABLE public."GitHubObservation" (
  id uuid PRIMARY KEY,
  "orgId" uuid NOT NULL,
  "projectId" uuid NOT NULL,
  "actorId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "projectRevision" integer NOT NULL CHECK ("projectRevision">0),
  "recordedAt" timestamptz(3) NOT NULL,
  "recordSha256" text NOT NULL CHECK ("recordSha256" ~ '^[a-f0-9]{64}$'),
  observation jsonb NOT NULL,
  CONSTRAINT "GitHubObservation_orgId_actorId_requestId_key" UNIQUE ("orgId","actorId","requestId"),
  CONSTRAINT "GitHubObservation_orgId_projectId_fkey" FOREIGN KEY ("orgId","projectId") REFERENCES public."Project" ("orgId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GitHubObservation_orgId_actorId_fkey" FOREIGN KEY ("orgId","actorId") REFERENCES public."Membership" ("orgId","userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT observation_shape CHECK (COALESCE(
    jsonb_typeof(observation)='object' AND observation->>'kind'='github-run-observation'
    AND observation->>'orgId'="orgId"::text AND observation->>'projectId'="projectId"::text
    AND jsonb_typeof(observation->'projectRevision')='number' AND observation->>'projectRevision'="projectRevision"::text
    AND observation->'artifactVerified'='false'::jsonb AND observation->'testCoverageVerified'='false'::jsonb
    AND observation->>'readinessEffect'='none' AND octet_length(observation::text)<=550000, false))
);
CREATE INDEX "GitHubObservation_orgId_projectId_recordedAt_id_idx" ON public."GitHubObservation" ("orgId","projectId","recordedAt" DESC,id DESC);
ALTER TABLE public."GitHubObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GitHubObservation" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."GitHubObservation" FROM PUBLIC,navyix_runtime;
CREATE POLICY observation_read ON public."GitHubObservation" FOR SELECT TO navyix_runtime USING (
  "orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member()
  AND EXISTS (SELECT 1 FROM public."ProjectMembership" p WHERE p."orgId"="GitHubObservation"."orgId"
    AND p."projectId"="GitHubObservation"."projectId" AND p."userId"=public.navyix_actor_id() AND p.active)
);
CREATE POLICY observation_insert ON public."GitHubObservation" FOR INSERT TO navyix_runtime WITH CHECK (
  "orgId"::text=current_setting('navyix.org_id',true) AND public.navyix_active_member() AND "actorId"=public.navyix_actor_id()
  AND EXISTS (SELECT 1 FROM public."Membership" m WHERE m."orgId"="GitHubObservation"."orgId"
    AND m."userId"=public.navyix_actor_id() AND m.active AND m.role IN ('OWNER','ADMIN','CONTRIBUTOR'))
  AND EXISTS (SELECT 1 FROM public."ProjectMembership" p WHERE p."orgId"="GitHubObservation"."orgId"
    AND p."projectId"="GitHubObservation"."projectId" AND p."userId"=public.navyix_actor_id() AND p.active AND p.role IN ('OWNER','ADMIN','CONTRIBUTOR'))
);
GRANT SELECT,INSERT ON public."GitHubObservation" TO navyix_runtime;
-- No UPDATE, DELETE, TRUNCATE, SECURITY DEFINER or owner-role grants.
COMMIT;
