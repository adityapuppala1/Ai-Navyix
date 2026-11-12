-- Opt-in project access management. Existing membership/owner policies remain unchanged.
-- Apply using the separate migration administrator, never the application identity.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='navyix_team_executor') THEN
    CREATE ROLE navyix_team_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='navyix_team_executor'
    AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
    OR pg_has_role('navyix_app','navyix_team_executor','MEMBER') THEN
    RAISE EXCEPTION 'Unsafe team function owner configuration';
  END IF;
END $$;
CREATE SCHEMA navyix_team;
REVOKE ALL ON SCHEMA navyix_team FROM PUBLIC;
GRANT USAGE ON SCHEMA navyix_team TO navyix_runtime, navyix_team_executor;
GRANT USAGE ON SCHEMA public TO navyix_team_executor;
ALTER TABLE public."ProjectMembership" ADD COLUMN "accessRevision" integer NOT NULL DEFAULT 1 CHECK ("accessRevision">0);
CREATE FUNCTION navyix_team.bump_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$ BEGIN
  NEW."accessRevision" := OLD."accessRevision" + 1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION navyix_team.bump_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION navyix_team.bump_revision() TO navyix_team_executor;
CREATE TRIGGER project_membership_revision BEFORE UPDATE ON public."ProjectMembership"
FOR EACH ROW EXECUTE FUNCTION navyix_team.bump_revision();

-- This NOLOGIN role is not granted to any application login. Its rights can only be
-- exercised through the two guarded SECURITY DEFINER functions below. RLS remains ON.
GRANT SELECT ON public."User", public."Organization", public."Membership", public."Project", public."ProjectMembership", public."WorkflowCommand" TO navyix_team_executor;
GRANT UPDATE(active) ON public."User", public."Organization", public."Membership" TO navyix_team_executor;
GRANT UPDATE(name) ON public."Project" TO navyix_team_executor;
GRANT UPDATE(role,active) ON public."ProjectMembership" TO navyix_team_executor;
GRANT INSERT ON public."ProjectMembership", public."WorkflowCommand", public."AuditEvent" TO navyix_team_executor;
CREATE POLICY team_user_read ON public."User" FOR SELECT TO navyix_team_executor USING (
  EXISTS(SELECT 1 FROM public."Membership" m WHERE m."userId"="User".id AND m."orgId"::text=current_setting('navyix.org_id',true)));
CREATE POLICY team_org_read ON public."Organization" FOR SELECT TO navyix_team_executor USING (id::text=current_setting('navyix.org_id',true));
CREATE POLICY team_membership_read ON public."Membership" FOR SELECT TO navyix_team_executor USING ("orgId"::text=current_setting('navyix.org_id',true));
CREATE POLICY team_project_read ON public."Project" FOR SELECT TO navyix_team_executor USING ("orgId"::text=current_setting('navyix.org_id',true));
CREATE POLICY team_access_read ON public."ProjectMembership" FOR SELECT TO navyix_team_executor USING ("orgId"::text=current_setting('navyix.org_id',true));
-- Locks require UPDATE privilege; these policies prohibit updates to identity/org data.
CREATE POLICY team_user_lock ON public."User" FOR UPDATE TO navyix_team_executor USING (true) WITH CHECK (false);
CREATE POLICY team_org_lock ON public."Organization" FOR UPDATE TO navyix_team_executor USING (true) WITH CHECK (false);
CREATE POLICY team_membership_lock ON public."Membership" FOR UPDATE TO navyix_team_executor USING (true) WITH CHECK (false);
CREATE POLICY team_project_lock ON public."Project" FOR UPDATE TO navyix_team_executor USING (true) WITH CHECK (false);
CREATE POLICY team_access_insert ON public."ProjectMembership" FOR INSERT TO navyix_team_executor WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true));
CREATE POLICY team_access_update ON public."ProjectMembership" FOR UPDATE TO navyix_team_executor USING ("orgId"::text=current_setting('navyix.org_id',true)) WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true));
CREATE POLICY team_command_read ON public."WorkflowCommand" FOR SELECT TO navyix_team_executor USING ("orgId"::text=current_setting('navyix.org_id',true)
  AND "actorId" IN (SELECT id FROM public."User" WHERE "oidcIssuer"=current_setting('navyix.issuer',true) AND "oidcSubject"=current_setting('navyix.subject',true) AND active));
CREATE POLICY team_command_insert ON public."WorkflowCommand" FOR INSERT TO navyix_team_executor WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true)
  AND "actorId" IN (SELECT id FROM public."User" WHERE "oidcIssuer"=current_setting('navyix.issuer',true) AND "oidcSubject"=current_setting('navyix.subject',true) AND active));
CREATE POLICY team_audit_insert ON public."AuditEvent" FOR INSERT TO navyix_team_executor WITH CHECK ("orgId"::text=current_setting('navyix.org_id',true)
  AND "actorId" IN (SELECT id::text FROM public."User" WHERE "oidcIssuer"=current_setting('navyix.issuer',true) AND "oidcSubject"=current_setting('navyix.subject',true) AND active));

CREATE FUNCTION navyix_team.authorize(target_project uuid) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid;
BEGIN
  SELECT u.id INTO actor FROM public."User" u
    JOIN public."Membership" m ON m."userId"=u.id
    JOIN public."Organization" o ON o.id=m."orgId"
    JOIN public."ProjectMembership" pm ON pm."orgId"=m."orgId" AND pm."userId"=u.id AND pm."projectId"=target_project
    WHERE u."oidcIssuer"=current_setting('navyix.issuer',true) AND u."oidcSubject"=current_setting('navyix.subject',true)
      AND m."orgId"::text=current_setting('navyix.org_id',true)
      AND u.active AND o.active AND m.active AND pm.active
      AND m.role IN ('OWNER','ADMIN') AND pm.role IN ('OWNER','ADMIN')
    FOR SHARE OF u,m,o,pm;
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Project access unavailable'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION navyix_team.authorize(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION navyix_team.authorize(uuid) TO navyix_team_executor;

CREATE FUNCTION navyix_team.directory(target_project uuid, after_user uuid, batch_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid; organization uuid; members jsonb; next_user text;
BEGIN
  actor := navyix_team.authorize(target_project);
  organization := current_setting('navyix.org_id')::uuid;
  IF batch_size IS NULL OR batch_size<1 OR batch_size>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid page size'; END IF;
  SELECT coalesce(jsonb_agg(row_data ORDER BY user_id),'[]'::jsonb) INTO members FROM (
    SELECT u.id AS user_id, jsonb_build_object('userId',u.id,'email',u.email,'organizationRole',m.role,
      'organizationActive',m.active AND u.active,'role',pm.role,'active',coalesce(pm.active,false),
      'accessRevision',coalesce(pm."accessRevision",0),
      'editable',u.id<>actor AND coalesce(pm.role::text,'')<>'OWNER',
      'allowedRoles', CASE WHEN m.role IN ('OWNER','ADMIN') THEN '["ADMIN","CONTRIBUTOR","REVIEWER","VIEWER"]'::jsonb
        WHEN m.role='CONTRIBUTOR' THEN '["CONTRIBUTOR","VIEWER"]'::jsonb WHEN m.role='REVIEWER' THEN '["REVIEWER","VIEWER"]'::jsonb ELSE '["VIEWER"]'::jsonb END) AS row_data
    FROM public."Membership" m JOIN public."User" u ON u.id=m."userId"
      LEFT JOIN public."ProjectMembership" pm ON pm."orgId"=m."orgId" AND pm."userId"=m."userId" AND pm."projectId"=target_project
    WHERE m."orgId"=organization AND (after_user IS NULL OR u.id>after_user)
    ORDER BY u.id LIMIT batch_size+1
  ) page;
  IF jsonb_array_length(members)>batch_size THEN
    next_user:=members->(batch_size-1)->>'userId';
    members:=members-batch_size;
  END IF;
  RETURN jsonb_build_object('orgId',organization,'projectId',target_project,'actorId',actor,'members',members,'next',next_user);
END $$;
REVOKE ALL ON FUNCTION navyix_team.directory(uuid,uuid,integer) FROM PUBLIC;

CREATE FUNCTION navyix_team.change_member(target_project uuid, target_user uuid, new_role text, new_active boolean,
  expected_revision integer, request_id uuid, request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid; organization uuid; org_role public."MembershipRole"; org_active boolean;
  prior public."WorkflowCommand"%ROWTYPE; membership public."ProjectMembership"%ROWTYPE; result jsonb; next_revision integer;
BEGIN
  actor:=navyix_team.authorize(target_project);
  organization:=current_setting('navyix.org_id')::uuid;
  IF new_role IS NULL OR new_role NOT IN ('ADMIN','CONTRIBUTOR','REVIEWER','VIEWER') OR new_active IS NULL
     OR expected_revision IS NULL OR expected_revision<0 OR request_id IS NULL OR request_hash IS NULL OR request_hash !~ '^[a-f0-9]{64}$'
     OR target_user IS NULL OR target_user=actor THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid access change';
  END IF;
  -- Serialize changes even where the target membership row does not exist yet.
  PERFORM id FROM public."Project" WHERE id=target_project AND "orgId"=organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Project access unavailable'; END IF;
  -- Recheck authority BEFORE replay. A revoked administrator cannot recover previous results.
  SELECT * INTO prior FROM public."WorkflowCommand" WHERE "orgId"=organization AND "actorId"=actor AND "requestId"=request_id;
  IF FOUND THEN
    IF prior."requestHash"<>request_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Request conflict'; END IF;
    RETURN prior.result;
  END IF;
  SELECT m.role, m.active AND u.active INTO org_role,org_active FROM public."Membership" m JOIN public."User" u ON u.id=m."userId"
    WHERE m."orgId"=organization AND m."userId"=target_user FOR SHARE OF m,u;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Member unavailable'; END IF;
  IF new_active AND (NOT org_active OR (org_role='VIEWER' AND new_role<>'VIEWER')
      OR (org_role='CONTRIBUTOR' AND new_role NOT IN ('CONTRIBUTOR','VIEWER'))
      OR (org_role='REVIEWER' AND new_role NOT IN ('REVIEWER','VIEWER'))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Role exceeds organization permissions';
  END IF;
  SELECT * INTO membership FROM public."ProjectMembership" WHERE "orgId"=organization AND "projectId"=target_project AND "userId"=target_user FOR UPDATE;
  IF membership.role='OWNER' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Owner membership is protected'; END IF;
  IF coalesce(membership."accessRevision",0)<>expected_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Membership revision conflict'; END IF;
  IF membership."userId" IS NULL THEN
    IF NOT new_active THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Membership does not exist'; END IF;
    INSERT INTO public."ProjectMembership" ("orgId","projectId","userId",role,active)
      VALUES(organization,target_project,target_user,new_role::public."MembershipRole",true) RETURNING "accessRevision" INTO next_revision;
  ELSE
    UPDATE public."ProjectMembership" SET role=new_role::public."MembershipRole",active=new_active
      WHERE "orgId"=organization AND "projectId"=target_project AND "userId"=target_user RETURNING "accessRevision" INTO next_revision;
  END IF;
  result:=jsonb_build_object('orgId',organization,'projectId',target_project,'userId',target_user,'role',new_role,'active',new_active,'accessRevision',next_revision,'requestId',request_id);
  INSERT INTO public."AuditEvent" (id,"orgId","actorId",action,"entityType","entityId",metadata,"createdAt")
    VALUES(gen_random_uuid(),organization,actor::text,'project.member.set','ProjectMembership',target_project::text||'/'||target_user::text,
      jsonb_build_object('requestId',request_id,'requestHash',request_hash,'beforeRole',membership.role,'beforeActive',membership.active,'result',result),now());
  INSERT INTO public."WorkflowCommand" ("orgId","actorId","requestId","requestHash",result) VALUES(organization,actor,request_id,request_hash,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION navyix_team.change_member(uuid,uuid,text,boolean,integer,uuid,text) FROM PUBLIC;
-- ALTER OWNER requires CREATE temporarily; it is revoked in this same transaction.
GRANT CREATE ON SCHEMA navyix_team TO navyix_team_executor;
ALTER FUNCTION navyix_team.directory(uuid,uuid,integer) OWNER TO navyix_team_executor;
ALTER FUNCTION navyix_team.change_member(uuid,uuid,text,boolean,integer,uuid,text) OWNER TO navyix_team_executor;
REVOKE CREATE ON SCHEMA navyix_team FROM navyix_team_executor;
GRANT EXECUTE ON FUNCTION navyix_team.directory(uuid,uuid,integer), navyix_team.change_member(uuid,uuid,text,boolean,integer,uuid,text) TO navyix_runtime;
COMMIT;
