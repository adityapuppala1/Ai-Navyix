-- Read-only discovery of the current verified identity's active organizations.
-- Does not grant membership, change roles, expose project data, or bypass RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE POLICY "Membership_personal_directory" ON public."Membership"
  FOR SELECT TO navyix_runtime USING (
    current_setting('navyix.personal_directory',true) = 'true'
    AND COALESCE(current_setting('navyix.org_id',true),'') = ''
    AND active AND "userId" = public.navyix_actor_id()
  );
CREATE POLICY "Organization_personal_directory" ON public."Organization"
  FOR SELECT TO navyix_runtime USING (
    current_setting('navyix.personal_directory',true) = 'true'
    AND COALESCE(current_setting('navyix.org_id',true),'') = ''
    AND active AND EXISTS (
      SELECT 1 FROM public."Membership" m WHERE m."orgId"="Organization".id
        AND m."userId"=public.navyix_actor_id() AND m.active
    )
  );
-- Existing actor identity, RLS, grants, ordinary scoped policies and project checks are retained.
-- No SECURITY DEFINER function or runtime mutation privilege is introduced.
COMMIT;
