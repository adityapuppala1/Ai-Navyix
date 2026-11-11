# Navyix — Design, Build, Test & Readiness

Navyix connects requirements, design decisions, builds, test evidence and explainable readiness
assessments. It includes a **working local workflow** and an **opt-in server-side workflow implementation**
inside the existing Next.js/NestJS/PostgreSQL foundation. It is **not a production-ready multi-tenant SaaS**.

## Try the actual workflow now

Node.js 22+ is enough; no package download, database or API key is required for the local preview:

```sh
node scripts/preview-workflow.mjs
```

Open the printed address, normally `http://127.0.0.1:4173`. Create a project or choose **Explore sample
workflow**. Add requirements and designs, record a build, define tests, import results, inspect readiness,
resolve a blocker with a retest, save an assessment and export its evidence. Sample records are synthetic;
new projects start empty. Build recording does not compile code; importing results does not run tests.

**The browser still stores local records.** Use non-sensitive data only. Local project separation and
review buttons are not authentication, RBAC or tenant isolation. No hosted AI, repository runner or customer
database is connected to this UI. A browser login and authenticated storage adapter are still pending.

## Latest development increment: server-side workflow

- Nest-mounted API for projects, workflow commands, result imports, readiness and assessment snapshots.
- Access-token verification adapter with issuer/audience/type/scope validation and Cognito access-token support.
- Database-loaded organization/project roles; no client-supplied role or auth bypass.
- Prisma/PostgreSQL repository, initial schema migration, forced RLS and restricted runtime role setup.
- Expected-revision writes, idempotency receipts, transactional audit and append-only-to-runtime snapshots.
- Default **disabled** until dependency, actual identity/database and full-build gates pass.

The implementation shares the exact readiness domain with the local UI. Read [SERVER_WORKFLOW.md](docs/SERVER_WORKFLOW.md)
for contracts, configuration, migration restrictions and the distinction between implemented code and verified deployment.
No database was provisioned or migrated and no cloud resource was created in this increment.

## Working local capabilities

| Area | Included |
| --- | --- |
| Requirements | Acceptance criteria, owners, revisions, local review records |
| Design | Decisions/tradeoffs linked to requirement versions |
| Builds | Commit SHA, artifact digest, environment and outcome |
| Tests | Versioned cases, steps, expectations, JSON report upload/paste |
| Readiness | Design/build/test/release evaluations and unknown/stale/failed evidence |
| History | Assessment snapshots and project/assessment JSON exports |
| Experience | Responsive views, light/dark themes, keyboard dialogs, reduced motion |

## Verification

```sh
node --test packages/workflow/test/*.test.mjs
node --test packages/server/test/*.test.mjs
```

The previous local-workflow increment recorded 65 Node checks and 25 offline Chromium checks; see
[its record](docs/VALIDATION_2026-11-11.md). The current server increment records **112 passing checks and
2 explicitly skipped integration gates**; see [the server validation record](docs/SERVER_VALIDATION_2026-11-11.md).
The passing checks include real loopback HTTP requests using test identity/storage adapters. They do NOT
prove JOSE signatures, PostgreSQL RLS, Nest wiring or browser sign-in. The strict integration mode fails
rather than skips when prerequisites are absent. Full application builds remain unverified because package
registry access is unavailable; no lockfile has been fabricated.

## Full application development

The stack remains Next.js/React/TypeScript, NestJS and PostgreSQL/Prisma. The homepage Three.js component
is retained. The local workbench uses a shared native component and dependency-free domain exposed through
Next.js `/workspace`; the new API is mounted in Nest rather than introducing a second production server.

On a network-enabled development machine, configure `.env` locally, then:

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --no-frozen-lockfile
pnpm --filter @navyix/api db:generate
pnpm --filter @navyix/api db:validate
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

Review/commit the generated `pnpm-lock.yaml` and switch future installs to frozen mode. Follow the server
guide before creating database roles or applying its initial migration. Do not reset any existing database.
Business routes remain absent by default; only a developer who supplies real OIDC/database settings and
explicitly enables NAVYIX_API_ENABLED can expose them. This is not authorization to deploy the application.

## Structure

- `apps/web`: Next.js presentation and canonical workbench UI.
- `apps/api`: NestJS hosting, Prisma schema/migrations and explicit administrative scripts.
- `packages/policy`: original readiness/authorization helpers.
- `packages/workflow`: shared domain, local persistence and tests.
- `packages/server`: command service, authentication adapter, transactional repository, HTTP handler and tests.
- `scripts`: workbench asset synchronization and loopback preview.
- `tests/workflow_browser.py`: browser workflow checks with an explicit offline mode.
- `docs`: product plan, architecture, UI/security guidance and measured validation records.

Do not edit generated `apps/web/public/workbench` assets directly.

## Development agreements

Continue on **main only** until the user requests another branch. GitHub Actions remain **manual-only**;
ordinary pushes must not trigger CI/CD and no workflow is dispatched without the user's request.
See [AGENTS.md](AGENTS.md).

## Read next

[Local workflow](docs/LOCAL_WORKFLOW.md) · [Server workflow](docs/SERVER_WORKFLOW.md) ·
[Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Security/RBAC](docs/SECURITY.md) ·
[UI/UX](docs/UX_SYSTEM.md) · [Foundation validation](docs/FOUNDATION_VALIDATION.md)

Next: resolve/build dependencies; validate real identity/PostgreSQL boundaries; connect the browser through
secure login/session handling; add trusted CI evidence; then approved-source AI and production operations.
