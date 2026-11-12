-- Opt-in invitation lifecycle. No email delivery, project grants, or owner/admin assignment.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='navyix_invitation_executor') THEN
    CREATE ROLE navyix_invitation_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='navyix_invitation_executor' AND
    (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
    OR pg_has_role('navyix_app','navyix_invitation_executor','member') THEN
    RAISE EXCEPTION 'Unsafe invitation executor';
  END IF;
END $$;
CREATE SCHEMA navyix_invitations;
REVOKE ALL ON SCHEMA navyix_invitations FROM PUBLIC;
GRANT USAGE ON SCHEMA navyix_invitations TO navyix_runtime,navyix_invitation_executor;
GRANT USAGE ON SCHEMA public TO navyix_invitation_executor;
CREATE TABLE navyix_invitations.invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  role public."MembershipRole" NOT NULL CHECK (role IN ('CONTRIBUTOR','REVIEWER','VIEWER')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','revoked','accepted')),
  created_by uuid NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES public."User"(id) ON DELETE RESTRICT,
  accepted_at timestamptz, revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours'),
  CHECK ((state='pending' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL AND accepted_by IS NULL AND accepted_at IS NULL)
    OR (state='accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND revoked_at IS NULL))
);
CREATE INDEX invitation_org_id ON navyix_invitations.invitation(org_id,id);
CREATE TABLE navyix_invitations.request (
  issuer text NOT NULL, subject text NOT NULL, request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  org_id uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  invitation_id uuid NOT NULL REFERENCES navyix_invitations.invitation(id) ON DELETE RESTRICT,
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  PRIMARY KEY (issuer,subject,request_id)
);
ALTER TABLE navyix_invitations.invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE navyix_invitations.invitation FORCE ROW LEVEL SECURITY;
ALTER TABLE navyix_invitations.request ENABLE ROW LEVEL SECURITY;
ALTER TABLE navyix_invitations.request FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA navyix_invitations FROM PUBLIC,navyix_runtime;
GRANT SELECT,INSERT ON navyix_invitations.invitation,navyix_invitations.request TO navyix_invitation_executor;
GRANT UPDATE(state,accepted_by,accepted_at,revoked_at) ON navyix_invitations.invitation TO navyix_invitation_executor;
CREATE POLICY invitation_executor_read ON navyix_invitations.invitation FOR SELECT TO navyix_invitation_executor USING (true);
CREATE POLICY invitation_executor_insert ON navyix_invitations.invitation FOR INSERT TO navyix_invitation_executor WITH CHECK (true);
CREATE POLICY invitation_executor_update ON navyix_invitations.invitation FOR UPDATE TO navyix_invitation_executor USING (true) WITH CHECK (true);
CREATE POLICY invitation_receipt_read ON navyix_invitations.request FOR SELECT TO navyix_invitation_executor USING (
  issuer=current_setting('navyix.issuer',true) AND subject=current_setting('navyix.subject',true));
CREATE POLICY invitation_receipt_insert ON navyix_invitations.request FOR INSERT TO navyix_invitation_executor WITH CHECK (
  issuer=current_setting('navyix.issuer',true) AND subject=current_setting('navyix.subject',true));
-- The NOLOGIN function owner is never granted to application logins. Functions below
-- are the only exposed way to exercise these privileges; runtime gets no table access.
GRANT SELECT ON public."User",public."Organization",public."Membership" TO navyix_invitation_executor;
GRANT INSERT ON public."User",public."Membership",public."AuditEvent" TO navyix_invitation_executor;
GRANT UPDATE(active) ON public."User",public."Organization",public."Membership" TO navyix_invitation_executor;
CREATE POLICY invitation_users_read ON public."User" FOR SELECT TO navyix_invitation_executor USING (true);
CREATE POLICY invitation_org_read ON public."Organization" FOR SELECT TO navyix_invitation_executor USING (true);
CREATE POLICY invitation_members_read ON public."Membership" FOR SELECT TO navyix_invitation_executor USING (true);
CREATE POLICY invitation_users_lock ON public."User" FOR UPDATE TO navyix_invitation_executor USING (true) WITH CHECK (false);
CREATE POLICY invitation_org_lock ON public."Organization" FOR UPDATE TO navyix_invitation_executor USING (true) WITH CHECK (false);
CREATE POLICY invitation_members_lock ON public."Membership" FOR UPDATE TO navyix_invitation_executor USING (true) WITH CHECK (false);
CREATE POLICY invitation_users_insert ON public."User" FOR INSERT TO navyix_invitation_executor WITH CHECK (
  "oidcIssuer"=current_setting('navyix.issuer',true) AND "oidcSubject"=current_setting('navyix.subject',true)
  AND email=current_setting('navyix.invitation_email',true) AND active);
CREATE POLICY invitation_members_insert ON public."Membership" FOR INSERT TO navyix_invitation_executor WITH CHECK (
  "orgId"::text=current_setting('navyix.org_id',true) AND role IN ('CONTRIBUTOR','REVIEWER','VIEWER') AND active
  AND EXISTS (SELECT FROM public."User" u WHERE u.id="userId" AND u."oidcIssuer"=current_setting('navyix.issuer',true)
    AND u."oidcSubject"=current_setting('navyix.subject',true) AND u.active));
CREATE POLICY invitation_audit_insert ON public."AuditEvent" FOR INSERT TO navyix_invitation_executor WITH CHECK (
  "orgId"::text=current_setting('navyix.org_id',true) AND "entityType"='OrganizationInvitation'
  AND action IN ('invitation.create','invitation.revoke','invitation.accept')
  AND EXISTS (SELECT FROM public."User" u WHERE u.id::text="actorId" AND u."oidcIssuer"=current_setting('navyix.issuer',true)
    AND u."oidcSubject"=current_setting('navyix.subject',true) AND u.active));

CREATE FUNCTION navyix_invitations.execute(command text, organization uuid, payload jsonb, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE
  v_issuer text:=current_setting('navyix.issuer',true); v_subject text:=current_setting('navyix.subject',true);
  verified_email text:=current_setting('navyix.invitation_email',true);
  actor public."User"%ROWTYPE; member public."Membership"%ROWTYPE;
  item navyix_invitations.invitation%ROWTYPE; receipt navyix_invitations.request%ROWTYPE;
  actor_id uuid; actual_role text; result jsonb; items jsonb; cursor_id uuid;
  org_name text; now_at timestamptz; created_id uuid; count_rows integer; page_size integer;
BEGIN
  IF v_issuer IS NULL OR v_issuer='' OR v_subject IS NULL OR v_subject='' OR length(v_subject)>255 OR
     command IS NULL OR command NOT IN ('list','create','revoke','preview','accept') OR
     payload IS NULL OR jsonb_typeof(payload)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid invitation request';
  END IF;
  IF command IN ('preview','accept') THEN
    IF verified_email IS NULL OR verified_email='' OR payload->>'tokenHash' IS NULL
      OR (payload->>'tokenHash') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable'; END IF;
    SELECT * INTO item FROM navyix_invitations.invitation WHERE token_hash=payload->>'tokenHash';
    IF NOT FOUND OR item.email<>verified_email THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable'; END IF;
    organization:=item.org_id;
  END IF;
  IF organization IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Organization required'; END IF;
  PERFORM set_config('navyix.org_id',organization::text,true);
  -- Serialize create/revoke/accept for one organization, including first membership insertion.
  SELECT name INTO org_name FROM public."Organization" WHERE id=organization AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization unavailable'; END IF;
  now_at:=clock_timestamp();
  SELECT * INTO actor FROM public."User" WHERE "oidcIssuer"=v_issuer AND "oidcSubject"=v_subject FOR SHARE;
  IF FOUND AND NOT actor.active THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Account unavailable'; END IF;
  actor_id:=actor.id;
  SELECT * INTO member FROM public."Membership" WHERE "orgId"=organization AND "userId"=actor_id FOR SHARE;
  IF command IN ('list','create','revoke') AND (actor_id IS NULL OR member.id IS NULL OR NOT member.active OR member.role NOT IN ('OWNER','ADMIN')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization access unavailable';
  END IF;
  IF command='list' THEN
    page_size:=(payload->>'limit')::integer; cursor_id:=(payload->>'after')::uuid;
    IF page_size IS NULL OR page_size<1 OR page_size>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid page'; END IF;
    SELECT coalesce(jsonb_agg(row_data ORDER BY id),'[]'::jsonb) INTO items FROM (
      SELECT i.id,jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'createdAt',i.created_at,'expiresAt',i.expires_at,
        'status',CASE WHEN i.state='pending' AND i.expires_at<=now_at THEN 'expired' ELSE i.state END) row_data
      FROM navyix_invitations.invitation i WHERE i.org_id=organization AND (cursor_id IS NULL OR i.id>cursor_id)
      ORDER BY i.id LIMIT page_size+1) page;
    result:=jsonb_build_object('orgId',organization,'invitations',items,'next',NULL);
    IF jsonb_array_length(items)>page_size THEN result:=jsonb_build_object('orgId',organization,'invitations',items-page_size,'next',items->(page_size-1)->>'id'); END IF;
    RETURN result;
  END IF;
  IF p_request_id IS NULL OR payload->>'requestHash' IS NULL OR (payload->>'requestHash') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Request identifier required';
  END IF;
  -- Replays do not bypass revocation or active-account checks. No membership is restored.
  SELECT * INTO receipt FROM navyix_invitations.request r WHERE r.issuer=v_issuer AND r.subject=v_subject AND r.request_id=p_request_id;
  IF FOUND THEN
    IF receipt.request_hash<>payload->>'requestHash' OR receipt.org_id<>organization THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Request conflict'; END IF;
    IF command='accept' AND (member.id IS NULL OR NOT member.active OR item.accepted_by IS DISTINCT FROM actor_id) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Membership unavailable';
    END IF;
    IF command='create' AND NOT EXISTS (SELECT FROM navyix_invitations.invitation i WHERE i.id=receipt.invitation_id AND i.state='pending' AND i.expires_at>clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable';
    END IF;
    RETURN receipt.result;
  END IF;
  IF command='create' THEN
    IF payload->>'email' IS NULL OR length(payload->>'email') NOT BETWEEN 3 AND 254 OR
       payload->>'role' IS NULL OR payload->>'role' NOT IN ('CONTRIBUTOR','REVIEWER','VIEWER') OR
       (payload->>'hours')::integer NOT BETWEEN 1 AND 72 OR payload->>'hours' IS NULL OR
       payload->>'tokenHash' IS NULL OR (payload->>'tokenHash') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid invitation input';
    END IF;
    SELECT count(*) INTO count_rows FROM navyix_invitations.invitation WHERE org_id=organization;
    IF count_rows>=200 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Pilot limit reached'; END IF;
    SELECT count(*) INTO count_rows FROM navyix_invitations.invitation WHERE org_id=organization AND state='pending' AND expires_at>now_at;
    IF count_rows>=50 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Pending invitation limit reached'; END IF;
    IF EXISTS (SELECT FROM navyix_invitations.invitation WHERE org_id=organization AND email=payload->>'email' AND state='pending' AND expires_at>now_at) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Pending invitation exists';
    END IF;
    INSERT INTO navyix_invitations.invitation(org_id,email,role,token_hash,created_by,created_at,expires_at)
      VALUES(organization,payload->>'email',(payload->>'role')::public."MembershipRole",payload->>'tokenHash',actor_id,now_at,
        now_at+make_interval(hours=>(payload->>'hours')::integer)) RETURNING * INTO item;
    result:=jsonb_build_object('orgId',organization,'invitationId',item.id,'email',item.email,'role',item.role,
      'expiresAt',item.expires_at,'status',item.state,'tokenHash',item.token_hash,'requestId',p_request_id);
  ELSIF command='revoke' THEN
    SELECT * INTO item FROM navyix_invitations.invitation WHERE id=(payload->>'invitationId')::uuid AND org_id=organization FOR UPDATE;
    IF NOT FOUND OR item.state='accepted' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable'; END IF;
    UPDATE navyix_invitations.invitation SET state='revoked',revoked_at=coalesce(revoked_at,now_at) WHERE id=item.id;
    result:=jsonb_build_object('orgId',organization,'invitationId',item.id,'status','revoked','requestId',p_request_id);
  ELSE
    -- Re-read under the organization lock. A revoked/expired code is never accepted.
    SELECT * INTO item FROM navyix_invitations.invitation WHERE id=item.id FOR UPDATE;
    IF item.state<>'pending' OR item.expires_at<=clock_timestamp() OR item.email<>verified_email THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable';
    END IF;
    -- A revoked or demoted inviter cannot confer fresh access using an earlier invitation.
    PERFORM u.id FROM public."User" u JOIN public."Membership" m ON m."userId"=u.id
      WHERE u.id=item.created_by AND u.active AND m."orgId"=organization AND m.active AND m.role IN ('OWNER','ADMIN') FOR SHARE OF u,m;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable'; END IF;
    IF actor_id IS NOT NULL AND (split_part(actor.email,'@',1)||'@'||lower(split_part(actor.email,'@',2)))<>verified_email THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Account identity unavailable';
    END IF;
    IF member.id IS NOT NULL AND NOT member.active THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Membership unavailable'; END IF;
    IF command='preview' THEN
      RETURN jsonb_build_object('orgId',organization,'organizationName',org_name,'role',item.role,'expiresAt',item.expires_at,'alreadyMember',member.id IS NOT NULL);
    END IF;
    IF actor_id IS NULL THEN
      -- No linking by email. Cross-identity collisions are refused, including case variants.
      PERFORM pg_advisory_xact_lock(hashtextextended('navyix-invite-sub|'||v_issuer||'|'||v_subject,0));
      PERFORM pg_advisory_xact_lock(hashtextextended('navyix-invite-email|'||lower(verified_email),0));
      IF EXISTS (SELECT FROM public."User" WHERE lower(email)=lower(verified_email)) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Account identity unavailable';
      END IF;
      INSERT INTO public."User"(id,"oidcIssuer","oidcSubject",email,active)
        VALUES(gen_random_uuid(),v_issuer,v_subject,verified_email,true) RETURNING id INTO actor_id;
    END IF;
    actual_role:=member.role::text;
    IF member.id IS NULL THEN
      INSERT INTO public."Membership"(id,"orgId","userId",role,active) VALUES(gen_random_uuid(),organization,actor_id,item.role,true);
      actual_role:=item.role::text;
    END IF;
    UPDATE navyix_invitations.invitation SET state='accepted',accepted_by=actor_id,accepted_at=clock_timestamp() WHERE id=item.id;
    result:=jsonb_build_object('orgId',organization,'organizationName',org_name,'role',actual_role,'alreadyMember',member.id IS NOT NULL,'requestId',p_request_id);
  END IF;
  INSERT INTO public."AuditEvent"(id,"orgId","actorId",action,"entityType","entityId",metadata,"createdAt")
    VALUES(gen_random_uuid(),organization,actor_id::text,'invitation.'||command,'OrganizationInvitation',item.id::text,
      jsonb_build_object('requestId',p_request_id,'role',item.role),clock_timestamp());
  INSERT INTO navyix_invitations.request(issuer,subject,request_id,request_hash,org_id,invitation_id,result)
    VALUES(v_issuer,v_subject,p_request_id,payload->>'requestHash',organization,item.id,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION navyix_invitations.execute(text,uuid,jsonb,uuid) FROM PUBLIC;
GRANT CREATE ON SCHEMA navyix_invitations TO navyix_invitation_executor;
ALTER FUNCTION navyix_invitations.execute(text,uuid,jsonb,uuid) OWNER TO navyix_invitation_executor;
REVOKE CREATE ON SCHEMA navyix_invitations FROM navyix_invitation_executor;
GRANT EXECUTE ON FUNCTION navyix_invitations.execute(text,uuid,jsonb,uuid) TO navyix_runtime;
COMMIT;
