# Navyix — Design, Build, Test & Readiness

Navyix connects requirements, design decisions, builds, test evidence and explainable readiness assessments. The repository now includes a **working local workflow**, alongside the existing Next.js/NestJS/PostgreSQL foundation. It is **not a production-ready multi-tenant SaaS**.

## Try the actual workflow now

Node.js 22+ is enough; no package download, database or API key is required for this local preview:

```sh
node scripts/preview-workflow.mjs
```

Open the address printed by the command, normally `http://127.0.0.1:4173`.

Create your own project or choose **Explore sample workflow**. Add requirements and design records, record a build, define tests, import results, inspect readiness, resolve a blocker with a new run, save an assessment, and export its evidence. Sample records are explicitly synthetic; your new projects start empty.

**Data stays in this browser.** Use non-sensitive data only. Local project separation and review buttons are not authentication, RBAC or tenant isolation. No AI provider, external repository, build runner or customer database is connected.

## Working capabilities

| Area | Included in the local increment |
| --- | --- |
| Requirements | Acceptance criteria, owners, revisions, local review records |
| Design | Decisions/tradeoffs linked to exact requirement versions |
| Builds | Complete commit SHA, artifact digest, environment and outcome |
| Tests | Versioned cases, steps, expectations, validated JSON report upload/paste |
| Readiness | Separate design/build/test/release evaluations, blockers, unknown/stale evidence |
| Traceability | Version-specific evidence inspector, owner and next action |
| History | Saved assessment snapshots and project/assessment JSON export |
| Experience | Responsive navigation, light/dark themes, keyboard modal behavior, reduced motion |

## Verification

```sh
node --test packages/workflow/test/*.test.mjs
```

This increment passed **65 Node checks** and **25 offline Chromium component/workflow checks**. See [the validation record](docs/VALIDATION_2026-11-11.md) for the environment, exact boundaries and unexecuted checks. The full framework builds remain unverified because package registry access was unavailable.

## Full application development

The existing stack remains Next.js/React/TypeScript, NestJS and PostgreSQL/Prisma. The homepage's Three.js component is retained. The local workbench uses one native web component and shared dependency-free domain modules, exposed through the Next.js `/workspace` route; it is not a separate replacement architecture.

On a network-enabled development machine:

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --no-frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

The first install must generate a real `pnpm-lock.yaml`; review/commit it and then use frozen installs. Do not fabricate a lockfile. Configure the API and database from `.env.example` before backend development. The API currently exposes only its foundation endpoints; production business APIs remain blocked pending trusted identity and tenant authorization.

## Structure

- `apps/web`: Next.js presentation and canonical workbench UI sources.
- `apps/api`: NestJS foundation and Prisma schema.
- `packages/policy`: original readiness/authorization helpers and tests.
- `packages/workflow`: runnable local domain, persistence adapter and regression tests.
- `scripts`: asset synchronization and loopback-only preview server.
- `tests/workflow_browser.py`: browser workflow verification, with an explicit offline-harness mode.
- `docs`: implementation plan, architecture, UX/security guidance and validation records.

Generated `apps/web/public/workbench` assets are copied automatically before web dev/build. Edit canonical sources, not generated assets.

## Development agreements

Continue on **`main` only** until the user requests another branch. GitHub Actions remain **manual-only**; ordinary pushes must not trigger CI/CD, and no workflow should be dispatched without the user's request. See [AGENTS.md](AGENTS.md).

## Read next

[Local workflow guide](docs/LOCAL_WORKFLOW.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Security and RBAC](docs/SECURITY.md) · [UI/UX system](docs/UX_SYSTEM.md) · [Foundation validation](docs/FOUNDATION_VALIDATION.md)

The next milestones are dependency/build validation, authenticated server persistence and tenant isolation, trusted CI evidence ingestion, then approved-source AI and production operations. Existing roadmap documents describe that target; they do not claim those capabilities are already implemented.
