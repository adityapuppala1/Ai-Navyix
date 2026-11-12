# Organization selection — opt-in connected-workspace integration

Reviewed base: `main` at `b42db2c8af9f4ae06fc6e29fbd2dd42bdb86850e`.
This source increment integrates the previously prepared organization picker into the existing workspace. It has not been deployed, and no migration has been applied. See ORGANIZATION_DIRECTORY_INTEGRATION_2026-11-12.md for the latest validation boundaries.

## User outcome

The existing connected Design / Build / Test / Readiness workbench can display a signed-in user's active organizations as named, keyboard-operable choices instead of requiring an organization UUID. Choosing one calls the existing `BrowserWorkspace.connect` path and the existing project APIs. It does not create a customer, grant a role, add project membership or authorize a release.

The first increment affects the connected workspace organization-selection step only. The team/evidence/history screens still retain their existing organization input. Invitations, account provisioning and organization signup are not implemented here. No email is sent and no AI provider is called.

## Disabled by default

Keep these false until reviewed dependencies, framework builds and the real database/browser acceptance gates pass:

```env
NAVYIX_API_ENABLED=false
NAVYIX_BROWSER_ENABLED=false
NAVYIX_DIRECTORY_ENABLED=false
```

Set DIRECTORY on both API and web only in the isolated development environment. The API refuses directory startup without its API flag and checks the runtime role and migration policies. The web renders the picker only when browser mode and the directory flag are enabled. Editing a DOM attribute cannot enable the backend or grant access. With the directory flag off, the current manual-ID experience remains unchanged.

## API and data minimization

`GET /v1/me/organizations?limit=20&after=UUID`

The endpoint uses the existing verified access-token authenticator. It takes only paging inputs: no user ID, organization ID, email, role or issuer supplied by the caller. The server derives the identity from the verified principal. Responses contain `{ organizations: [{ id, name, role }], next }`. The role is a display value, not a new authorization decision. Unknown/inactive identities receive no memberships. Internal errors are redacted and responses are non-cacheable.

The browser calls `GET /api/browser/api/me/organizations` through the existing HttpOnly session proxy. The new route is GET-only, with bounded parameters and no arbitrary destination. The browser receives no access token and stores no directory data in localStorage. It keeps one bounded page in memory; revoked/failed refreshes clear it. Changing session context or disposing the picker invalidates pending responses.

## Database migration and isolation

Migration `202611120006_organization_directory` adds two SELECT policies, not tables, roles, SECURITY DEFINER functions or mutation grants. The repository uses a READ ONLY transaction, verified issuer/subject, a blank organization context and a transaction-local `navyix.personal_directory=true` switch. The additional Membership policy sees only active memberships for `navyix_actor_id()`. Organization visibility follows those memberships and excludes suspended organizations. Existing user identity policies still apply.

Ordinary project requests retain their existing explicit organization context and project-membership checks. Directory mode does not expose project/workflow records because it has no organization context. Context values expire with the transaction rather than being retained by a pooled connection. No ordinary scoped policy is removed or replaced.

These properties are designed and covered by contract tests, but the new policies have NOT executed against PostgreSQL here. Review the interaction with all earlier policies and run the live suite before enabling the feature. As elsewhere in this application, shared database credentials are not an end-user authentication boundary against arbitrary application compromise. A database administrator can bypass application controls.

Membership changes apply to subsequent authorized requests. Already-dispatched reads are not retrospectively cancelled. Pages are fresh individual reads, not a multi-page database snapshot. Selection does not trust an old displayed role: the existing project endpoint rechecks current membership.

## Tests and acceptance

```sh
# Focused, dependency-light checks; live database group is explicitly skipped when unavailable.
node --test packages/server/test/directory*.test.mjs packages/browser-session/test/organization*.test.mjs
# Strict database gate, only with the documented migrated disposable DB and installed dependencies:
NAVYIX_REQUIRE_INTEGRATION=1 node --test packages/server/test/directory-live.test.mjs
# Existing explicit disposable lab includes this new suite with the committed integration edits:
node scripts/integration-lab.mjs --run --full --report ../navyix-acceptance-result.json
# Component-only browser checks, not live login/Next/database tests:
python tests/organization_directory_browser.py --offline
```

On PowerShell set the environment variable using `$env:NAVYIX_REQUIRE_INTEGRATION='1'` before invoking Node. Never supply customer database URLs for these tests. The live group prepares nine nested scenarios: owned versus foreign memberships, pooled identity changes, pagination, unknown identity, context reset, no project exposure/write access, membership revocation, organization suspension and user disablement. Cleanup deletes only generated fixture IDs.

Next acceptance steps: review the source increment on main; resolve and review the genuine lockfile; run semantic typecheck/lint/Next/Nest builds; migrate the disposable database and pass strict tests; verify real-provider login and both organizations in the rendered connected workspace. Customer invitations follow that validated selection flow. Preparing this small onboarding step does not mark G1–G3 complete or enable customer access.

## References

- PostgreSQL row-security composition: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- OWASP authorization checks on every request: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

These document the control goals, not acceptance or certification of this unexecuted migration.

## Connected-screen behavior

The parent accepts only a choice from the currently displayed picker and acknowledges it synchronously before connecting. If no parent accepts a choice, the picker re-enables its controls and shows a recoverable error instead of becoming stuck. The selected organization name is displayed after a successful connection; it is never used as authorization. Late responses, sign-out, denied membership, and unconfirmed saves retain the existing server-access boundaries.

Additional offline connected-shell checks:

```sh
python tests/organization_workspace_browser.py
```

This harness executes the actual connected component, picker and BrowserWorkspace adapter with a synthetic API and a presentation stub for the unchanged local-workbench superclass. It does not validate the full workflow screens, Next, cookies, a live identity provider or PostgreSQL. The earlier standalone component harness remains available.
