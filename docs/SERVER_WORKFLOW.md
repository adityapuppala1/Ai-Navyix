# Server-side Design -> Build -> Test -> Readiness increment

## State and boundaries

This increment adds an opt-in business API to the existing NestJS service. It reuses the exact
`packages/workflow/src/workflow.mjs` evaluator used by the local workbench. It is not a replacement
product, a second production web server, or a finished customer-ready deployment.

**The existing browser UI still uses local storage.** No browser login/session flow or automatic
transfer of local records to the backend has been implemented. Never treat the local UI's reviews
as authenticated approvals. The new server records authenticated actor metadata when configured,
but its starter readiness decisions remain advisory and manually supplied build/test evidence
remains unverified. No CI job, customer code, model call or deployment is started by this increment.

`NAVYIX_API_ENABLED=false` is the default. With it disabled only existing health routes are active.
With it enabled, startup requires a configured access-token verifier and a migrated database using
a restricted runtime identity. `/v1/health/ready` returns 503 while disabled or if its database probe
fails; a development-enabled response explicitly says `productionValidated:false`.

## Capabilities

The API supports creating and listing projects, reading their workflow state, requirements and
design commands, recording builds, defining tests, importing results, evaluating readiness,
saving assessment snapshots and fetching their JSON. Every mutation requires an idempotency UUID;
every existing-project command also requires the expected project revision. Concurrent edits return
409 rather than silently overwrite. An exact retried command returns the original acknowledgement.
Project creation, workflow state, command receipt, audit and assessment snapshot writes are transactional.

Only explicit command DTOs are accepted; there is no wholesale project-state replacement endpoint.
The API never trusts user-supplied role, actor, organization-membership, review-time or policy fields.
The `owner` value on a record is a display/assignment label, not a permission.

## Permission model

A verified issuer+subject identifies a pre-provisioned user. The API re-reads active user,
organization, organization membership and explicit project membership inside the transaction.
Token role/email/org claims and client headers do not grant membership. Organization and project
roles must BOTH permit an operation. Owners/admins require explicit project membership to read
project content; creation gives the creator a project-owner membership.

| Action | Allowed organization AND project roles |
| --- | --- |
| Read/list accessible projects and advisory readiness | OWNER, ADMIN, CONTRIBUTOR, REVIEWER, VIEWER |
| Add/revise requirements, designs, builds, tests or results | OWNER, ADMIN, CONTRIBUTOR |
| Record requirement/design reviews or assessment snapshots | OWNER, ADMIN, REVIEWER |
| Create a project | Organization OWNER or ADMIN |

There is no anonymous signup, invitation endpoint, role-edit endpoint, support impersonation or
runtime user-provisioning endpoint yet. Provisioning is an explicit administrative operation.
Self-review by an authorized owner is currently allowed; independent two-person review is not yet a policy.
A revocation takes effect for subsequent transactions; row locks coordinate it with an already-running
transaction. Actual PostgreSQL locking/RLS behavior must pass the live integration gate.

## Persistence decision

`WorkflowState` is a bounded JSONB project aggregate with an expected revision. This preserves
one domain model for the working slice while making its persistence server-owned. Relational
User/Organization/Membership/Project/ProjectMembership records define access. WorkflowCommand
receipts and WorkflowSnapshot records are append-only to the runtime database role. AuditEvent
captures actor, operation, request hash and revision without copying submitted content into logs.
Existing normalized draft models are retained for later migration; they are NOT populated in parallel
and are not authoritative for this increment.

Limits: 100 projects per organization, 50 project summaries per page, 1 MB request bodies, 3 MB
serialized project aggregates and the existing workflow record limits. JSONB transactions serialize
edits within a project; high-volume historical evidence and large artifacts must move to normalized
records/object storage before lifting these pilot limits. No backups or retention service are created here.

The initial migration is for an EMPTY development database. It is not an upgrade/reset script for
an existing database. Do not use `db push`, delete data or reset migrations to bypass drift errors.
Use a reviewed baseline/upgrade migration for any database that already has tables.

## Access tokens

`jose` verifies signatures using a statically configured HTTPS JWKS endpoint, exact issuer,
allowlisted signing algorithms, expiration and issued-at claims. API tokens are limited to a
one-hour lifetime and require an explicitly configured API scope.

- `jwt-access` requires an exact audience and `at+jwt` type (RFC 9068). ID tokens are rejected.
- `cognito-access` requires RS256, `token_use=access`, the configured `client_id` and API scope.
  Cognito access tokens are not treated as ID tokens and do not need an ID-token audience.

Only Authorization: Bearer is accepted. No token is stored in localStorage, no role header is accepted,
and there is no auth-bypass environment variable. This is the backend verifier, not a complete browser
OIDC Authorization Code + PKCE login flow. Provider outage fails closed. JWT revocation beyond token
expiry is not implemented; database user/member suspension can deny application access meanwhile.

## Configuration and first real validation

The Prisma command wrapper loads the same optional root `.env` as Nest and uses Node to launch the CLI, without shell-specific quoting.

Package registry access was unavailable during this increment. There is still no resolved lockfile,
full Nest/Next build, installed JOSE verification result or live PostgreSQL result. On a network-enabled
DEVELOPMENT machine, resolve dependencies once and review the generated lockfile before committing it.
Do not run GitHub Actions without the user's request.

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --no-frozen-lockfile
pnpm --filter @navyix/api db:generate
pnpm --filter @navyix/api db:validate
pnpm test:server
pnpm typecheck
pnpm lint
pnpm build
```

Merge the variables from `apps/api/.env.server.example` into the root `.env`. Supply actual values
locally; do not upload secrets. DATABASE_URL must use the restricted application login.
MIGRATION_DATABASE_URL is for an administrative migration/provisioning identity only (with the
necessary database ownership/role creation/BYPASSRLS rights); never run the API under that identity.

For a disposable PostgreSQL development database, an administrator applies `apps/api/prisma/roles.sql`
first, sets a fresh application-login password using psql `\password navyix_app`, and then runs:

```sh
pnpm --filter @navyix/api db:migrate:deploy
```

The migration enables and forces RLS on all 16 tables. Runtime permissions are limited to the implemented
workflow. Membership rows permit row locks through UPDATE USING policies but deny actual UPDATE through
WITH CHECK(false). Runtime cannot UPDATE/DELETE/TRUNCATE snapshots, command receipts or audit records.
Every request sets issuer, subject and org context transaction-locally, never for the pooled session.
Startup rejects owner/inherited-owner, superuser and BYPASSRLS identities and missing forced RLS.
These controls are code/migration definitions until verified against a real database.

Provision an organization through `apps/api/scripts/bootstrap-organization.mjs` using a local JSON file
with `name`, `slug`, `issuer`, `subject`, `email`. The issuer+subject must identify a real pre-created IdP
user. Existing identities are matched by issuer+subject, never silently by email. Set
`CONFIRM_ORG_BOOTSTRAP=yes` and use `pnpm --filter @navyix/api org:bootstrap path/to/input.json`.
The script creates no password, token or default admin. It does not run automatically.

Run the strict integration gate with `NAVYIX_REQUIRE_INTEGRATION=1`,
`NAVYIX_TEST_DB_CONFIRM=disposable`, `NAVYIX_TEST_DATABASE_URL` (runtime login) and
`NAVYIX_TEST_ADMIN_URL` (disposable-test administrator) configured:

```sh
node --test packages/server/test/integration.test.mjs
```

Strict mode fails instead of skipping when prerequisites are missing. Default `pnpm test:server`
clearly reports unconfigured integrations as skipped. Only after these gates and review should a
developer set NAVYIX_API_ENABLED=true and start `pnpm --filter @navyix/api dev` on loopback.

## HTTP contract

All paths below begin with `/v1/orgs/{organizationUuid}/projects`. All responses are JSON and no-store.
No CORS permission is added; a future same-origin session/BFF must be designed separately.

| Method/path | Purpose |
| --- | --- |
| GET / | Project summaries, optional `after` UUID and `limit` 1–50 |
| POST / | Create project: name, goal, owner, optional environment |
| GET /{projectUuid} | Complete bounded project state/export |
| POST /{projectUuid}/commands | Apply one workflow command |
| GET /{projectUuid}/readiness | Evaluate `stage`, optional `buildId`/`environment` |
| GET /{projectUuid}/report-template?buildId=BLD-001 | Version-bound report with skipped defaults |
| GET /{projectUuid}/assessments/ASM-001 | Immutable-to-runtime saved snapshot |

POST requests require `Content-Type: application/json` and `Idempotency-Key: <fresh UUID>`.
For a network retry use the SAME key and SAME body. After an intentional edit use a fresh key.
An existing-project command body is:

```json
{
  "expectedRevision": 1,
  "type": "requirement.add",
  "input": { "title": "Email OTP login", "acceptance": "Expired codes are rejected." }
}
```

Command names: requirement.add, requirement.update, requirement.review, design.add, design.review,
build.add, test.add, test.update, results.import, assessment.create. Their input fields reuse the
local workflow documented in LOCAL_WORKFLOW.md. Review expectedRevision on the nested requirement
is separate from expectedRevision on the whole project. Acknowledgements contain projectId,
revision and requestId; GET the project to retrieve the latest state.

Error status: 400 invalid input; 401 invalid/missing token; 403 insufficient role; 404 inaccessible
resource; 409 revision/idempotency/concurrency conflict; 413 body/state too large; 415 wrong content
type/encoding. Internal errors return a correlation UUID without SQL, tokens or credentials.

## Next gates, in order

1. Registry access, actual lockfile, dependency audit, full builds/typechecks/lint.
2. Live JOSE/PostgreSQL/RLS tests and reviewed migration against a disposable database.
3. Browser Authorization Code + PKCE, server-side session handling and authenticated UI adapter.
   Do not add token-paste login or copy sensitive localStorage data automatically.
4. Invitations/project membership administration, lifecycle and security review.
5. Independently identified GitHub/build/test evidence, audit export and provenance.
6. Approved-source AI, budgets/evaluations; never let AI override a readiness result.
7. Deployment, monitoring, recovery, accessibility/load/security and customer pilot acceptance.

## Primary references used

- PostgreSQL row policies: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- PostgreSQL policy application to SELECT FOR SHARE: https://www.postgresql.org/docs/17/sql-createpolicy.html
- JOSE JWT verification: https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md
- Cognito access-token claims: https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html

These references support library/platform behavior, not validation of this implementation.
