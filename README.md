# Navyix — Engineering intelligence, backed by evidence

Navyix is an early-stage, multi-tenant readiness platform connecting requirements, designs, build provenance, test evidence and release decisions. **This repository is a secure-by-default development foundation, not a finished SaaS product.**

## Included now
- Next.js App Router responsive UI foundation with component tokens, accessible navigation, a clearly marked illustrative dashboard, and a reduced-motion-aware Three.js hero.
- NestJS service shell with health endpoints and API contract placeholder. Protected business APIs remain **unavailable** until trusted OIDC authentication and tenant authorization are implemented.
- Prisma/PostgreSQL schema for organizations, memberships, projects, requirements, build artifacts, evidence, policy versions, assessment snapshots, AI grants and audit events.
- Dependency-free deterministic readiness evaluator with real unit tests; AI must never make the readiness decision.
- Dockerfiles, local PostgreSQL compose, sample environment variables, manual-only GitHub Actions CI, ADRs, threat model, delivery phases, and acceptance matrix.

## Local setup
Prerequisites: Node.js >= 22, Corepack/pnpm 9, Docker (for PostgreSQL).

```bash
corepack enable
pnpm install
cp .env.example .env
cp .env.example apps/api/.env
# Start a local database (or use an existing PostgreSQL instance):
docker compose up -d db
pnpm --filter @navyix/api db:generate
pnpm --filter @navyix/api db:migrate:dev
pnpm dev
# Web http://localhost:3000 | API http://localhost:4000/v1/health
```

To test the independent policy engine **without installing packages**:

```bash
node --test packages/policy/test/*.test.mjs
```

For dependency-involved validation (after `pnpm install`):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

**Do not treat local demo records as evidence.** The UI has a visible demonstration label until production API authentication and data are connected. Never use the sample environment values for real customers. Do not expose the local database port publicly.

## Branch and CI policy
- Continue on the existing **`main`** branch. Do not create feature/release branches unless explicitly requested.
- `.github/workflows/manual-ci.yml` runs **only** with `workflow_dispatch`. No `push`, `pull_request`, scheduled, or deployment trigger is configured.
- Local validation before each change is strongly recommended. Production promotion is out of scope and cannot happen automatically.

## Architecture and roadmap
Read [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/UX_SYSTEM.md](docs/UX_SYSTEM.md) and [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md).

## Current limitations
No hosted infrastructure, customer billing, functional login, GitHub connector, file ingestion, AI inference, CI executor, or release gating exists yet. Dependency installation, application compilation and browser testing require package registry/network access and have **not** been validated in this environment. Policy unit tests can run locally with Node.