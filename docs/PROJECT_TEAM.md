# Project team access — opt-in increment

This feature assigns existing organization members to an existing Navyix project so contributors and reviewers can collaborate on the Design / Build / Test / Readiness workflow. It does not invite users, create identities, edit organization roles, transfer ownership, or enable AI/integrations.

## Current boundary

Implemented source is not a production acceptance result. No live database migration or framework build was executed for this increment. Keep these switches false until dependencies, builds, live PostgreSQL/JOSE tests and deployed browser checks pass:

```env
NAVYIX_API_ENABLED=false
NAVYIX_BROWSER_ENABLED=false
NAVYIX_TEAM_ENABLED=false
```

Set TEAM on both API and web only in the isolated validation environment after applying all reviewed migrations, regenerating Prisma and passing the strict lab. The API rejects a true team switch when API is disabled and asserts the restricted function-owner configuration before mounting team routes. Web navigation exposes `/workspace/team` only when browser and team switches are true. The BFF allowlist cannot enable a disabled backend route.

## User flow

Sign in with the existing browser session, open **Manage project team access**, connect an organization UUID and choose an authorized project. An owner/admin can view the paginated existing-member directory, choose an allowed project role, confirm the named user/project, grant/change access or revoke it. Email addresses are visible only through this authorized administration flow. Granting project access never changes organization membership or role.

- Both organization and project roles must be OWNER or ADMIN for each list, write and replay.
- No self-editing, OWNER assignment, or editing existing OWNER project memberships.
- Organization CONTRIBUTOR can receive CONTRIBUTOR or VIEWER; REVIEWER can receive REVIEWER or VIEWER; VIEWER can receive VIEWER. Organization OWNER/ADMIN can receive any non-owner project role.
- Suspended/inactive users and memberships cannot receive an active grant.
- Organization/project UUIDs and editable controls are context, not authorization.
- Native confirmation dialogs initially focus Cancel. Unconfirmed writes retain the same request ID and payload; switching context and new writes stay disabled until resolved.
- Denied reloads clear the directory. Expiration and the existing cross-tab sign-out channel clear in-memory content. The client stores neither tokens nor customer records in localStorage.

## API

`GET /v1/orgs/:org/projects/:project/team?limit=20&after=UUID` returns an authorized member page and next cursor. Maximum page size: 50.

`POST /v1/orgs/:org/projects/:project/team/commands` requires the normal verified API access token and `Idempotency-Key: UUID`:

```json
{"userId":"EXISTING_USER_UUID","role":"REVIEWER","active":true,"expectedRevision":0}
```

Revision zero means no project membership currently exists. Existing rows use the returned accessRevision. The acknowledgement includes orgId, projectId, userId, role, active, accessRevision and requestId. The browser uses the same-origin BFF, HttpOnly session, CSRF protection and original-request retry semantics; it never handles the API access token.

## Database and security review

Migration `202611120003_project_team` adds a membership revision column/trigger and two narrowly granted SECURITY DEFINER entry points. Their owner is the dedicated `navyix_team_executor` NOLOGIN/NOINHERIT/NOBYPASSRLS role, never granted to the application. This role has no table ownership. Functions use fixed search_path `pg_catalog`, explicitly qualified tables, row_security=on, parameterized inputs, scoped policies and current membership checks. PUBLIC function execution is revoked in the same migration transaction. The private authorization helper is not executable by runtime credentials.

This is an intentional exception to the initial invoker-only design: granting runtime general member-directory or role-update privileges would broaden access. Only the guarded directory/change functions receive runtime EXECUTE. Review this migration as a sensitive permission boundary and execute the live tests before enabling it. Ordinary workflow RLS and OWNER protection remain unchanged.

Access changes are serializable. Actor and target membership rows are locked; a project lock serializes first grants. An expected membership revision prevents lost updates. A trigger increments the revision for privileged out-of-band updates too. Membership mutation, audit event and idempotency receipt commit together. Replays reauthorize the administrator before returning a recorded receipt. They confirm the historical operation, not that its grant remains current; the browser reloads the directory afterward. Revocation affects subsequent authorized requests, not requests already completed.

API authentication and trusted transaction context remain essential. Database credentials are not a user-authentication boundary against arbitrary application compromise. Keep application, browser-session and migration identities separate; never give the application owner/BYPASSRLS credentials.

## Verification commands

```sh
node --test packages/server/test/team.test.mjs packages/server/test/team-http.test.mjs packages/browser-session/test/team-client.test.mjs packages/browser-session/test/team-proxy.test.mjs
node scripts/integration-lab.mjs
# Only after actual dependency/lockfile and local Docker prerequisites are satisfied:
node scripts/integration-lab.mjs --run --full --report ../navyix-acceptance-result.json
```

The lab now includes `team-live.test.mjs` with real function/RLS/revision/audit tests. No silent pass when prerequisites are absent: strict mode fails. The separate browser harness `python tests/team_browser.py --offline` checks the exact component/client with synthetic API and broadcast events. It does not verify real sessions, Next, database security, or production navigation.

Rollback of an application rollout means disable TEAM on API and web, leaving existing data/audit records intact. Do not drop schemas or delete memberships to roll back UI code. This increment adds no dependencies, CI events or automatic migrations.

## Remaining acceptance and product work

Full lockfile/typecheck/lint/Next/Nest/container builds, actual restricted-role PostgreSQL migrations, real OIDC login, two-organization rendered browser tests, accessibility/security/load/recovery validation remain gates. Invitations, organization signup, owner transfer, trusted GitHub evidence and approved-source AI are later features, not implemented by this panel.

Design references: PostgreSQL CREATE FUNCTION security guidance and OWASP Authorization Cheat Sheet. These support the controls; they do not certify this unexecuted migration.
- https://www.postgresql.org/docs/16/sql-createfunction.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
