# Navyix — disposable database acceptance lab

Prepared against `main` at `8e0a2497f0a63d800499217d9bdefaa3299bb8c3`.
Originally delivered as a local patch; now incorporated into the project-team increment. This document is not a passing production acceptance result.

## Purpose

Close the gap between tests using memory/provider substitutes and the real database/cryptographic gates.
The runner uses the existing Prisma migrations, runtime repository, workflow service and JOSE integration tests.
It adds 13 live acceptance scenarios for the same Design → Build → Test → Readiness workflow.
It does not introduce another backend, dashboard or authentication bypass.

The companion transaction-error fix maps raw-query serialization/deadlock/unique-conflict SQLSTATEs wrapped in
Prisma `P2010` to the existing redacted HTTP 409 response. It does not automatically replay a write or treat
unrelated permission/syntax errors as retryable conflicts.

## Prerequisites

Use Node.js 22+, the repository's pinned pnpm version, a reviewed real `pnpm-lock.yaml`, installed development
dependencies, and Docker Engine 28+ running Linux containers through a LOCAL Unix socket or Windows named pipe.
A named local Docker context is required; DOCKER_HOST and remote TLS overrides are deliberately refused.

From the actual Ai-Navyix root, the first dependency resolution remains an explicit developer action:

```sh
corepack enable
pnpm install --no-frozen-lockfile
```

Review the generated lockfile and dependency audit findings. Subsequent installs should use
`pnpm install --frozen-lockfile`. The lab never installs packages or creates/fabricates a lockfile.

Explicitly obtain and review the official PostgreSQL image before using the lab:

```sh
docker pull postgres:17-alpine
docker image inspect postgres:17-alpine
```

The tag tracks PostgreSQL 17 patch updates; it is not an immutable version pin. The runner records the resolved
image ID and repository digest and creates the container from that ID, not the mutable tag. A reviewed immutable
`postgres@sha256:...` may be supplied with `--image`. No image is pulled automatically.

Docker 28+ is required because older Docker versions can expose localhost-published ports to neighboring hosts.
See the official Docker port-publishing documentation under References. This guard does not replace host security.

## Commands

Run the new dependency-free unit/runner checks:

```sh
node --test scripts/test/integration-lab.test.mjs packages/server/test/transaction-errors.test.mjs
```

Check prerequisites without creating resources:

```sh
node scripts/integration-lab.mjs
```

Run real JOSE and PostgreSQL acceptance against an automatically provisioned, disposable LOCAL container:

```sh
node scripts/integration-lab.mjs --run --report ../navyix-integration-result.json
```

Also request the existing full application verification sequence:

```sh
node scripts/integration-lab.mjs --run --full --report ../navyix-full-result.json
```

The full option additionally runs `scripts/verify-workspace.mjs --full` (Prisma generation/validation,
typechecking, lint, regressions, and framework builds). It does not deploy the application or build Docker images
for the web/API. The new scripts do not alter GitHub Actions or dispatch workflows.

## What --run does

1. Check the real lockfile, dependency resolution and relevant repository files.
2. Verify a local Docker context, supported engine and already-present image.
3. Generate independent random per-run database passwords. No shared/default administrator password exists.
4. Create a uniquely labeled/named container with a dynamic port bound to `127.0.0.1`, memory-backed database
   storage and CPU/memory/process limits. No host directory, Docker socket or customer volume is mounted.
5. Create the existing restricted application/session roles, then validate/generate Prisma and apply the existing
   migrations to this new empty database. Runtime, migration and browser identities remain separate.
6. Run real JOSE signature tests, restricted-session persistence tests, live two-organization workflow tests, and the project-team access suite.
7. Reject a missing, empty, failed, cancelled or skipped integration summary even if the subprocess exits zero.
8. Optionally execute the full application checks, then remove only the container whose ID and per-run ownership
   label match. A cleanup failure makes the run unsuccessful. No `docker prune` is used.

Existing environment database URLs and cloud/model secrets are not inherited by test subprocesses. Connection
URLs are generated from the newly verified loopback port; existing `.env` files are not rewritten. Administrator
credentials are only for this disposable fixture. Docker administrators can inspect container environment values;
this is a local development facility, not a security boundary against a host administrator.

The wrapper captures child output, redacts generated credentials and database URLs, and retains bounded failure
diagnostics. Stop/interruption paths attempt cleanup. If Docker itself becomes unavailable or the process/machine
is forcibly terminated, inspect the uniquely named container in the report and remove that specific resource after
review. Automatic cleanup is not a guarantee against power loss or an unavailable daemon.

## Real acceptance coverage

The new live suite uses the actual WorkflowService and Prisma repository, with generated fixture identities and
separate restricted connections. It checks:

- Separate organization/project reads, known foreign identifiers, and explicit project membership.
- Viewer/contributor/reviewer write and review boundaries.
- Requirement → design → build → failed test → passing retest → assessment persistence.
- Requirement-change invalidation without modification of historical snapshots.
- Invalid-report rollback, conflicting edits through two connections, and idempotent retries.
- Organization/project membership revocation, organization suspension, and disabled identities.
- Row-level security with absent/forged context and context cleanup on reused connections.
- Runtime inability to rewrite audit/snapshot records, truncate workflow data, or become the database administrator.

All records use synthetic content and randomly generated fixture UUIDs. Cleanup deletes only this fixture's
records; it never truncates shared tables. The script accepts no arbitrary target database URL.

These are service/database tests. They do NOT test an actual OIDC provider login, browser redirects, real cookie
behavior, rendered UI, hosted AI, external GitHub evidence or a customer deployment. JOSE key retrieval in the
existing signature tests is local; the actual cryptographic verifier is used when its dependency is installed.

## Reports and exit status

`prerequisites-passed` means only preflight. `requested-checks-passed` means only the checks explicitly requested
by that invocation. `fullBuild: not-requested` must never be presented as a successful Next.js/NestJS build.
Report files are created exclusively; an existing output file is never overwritten. Choose a fresh report filename for each run.
Reports retain a separate `remaining` list. None of these statuses is a product release approval.

Exit codes: 0 = requested checks passed; 1 = execution/cleanup failure; 2 = unmet prerequisites; 130 = interrupted.
Default application/browser feature flags remain false. No existing data is uploaded or migrated.

## What was executed for this delivery

See `ACCEPTANCE_VALIDATION_2026-11-12.md`. The 82 unit/runner tests passed in the authoring container.
Real Docker/PostgreSQL/JOSE and full application checks remain blocked and have NOT passed.

## References

Primary documentation checked on 12 November 2026:

- Docker port publishing: https://docs.docker.com/engine/network/port-publishing/
- PostgreSQL row security: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Prisma v6 error codes (P2010/P2034): https://www.prisma.io/docs/orm/v6/reference/error-reference

The documented platform behavior supports these checks; it does not certify this unexecuted live integration.
