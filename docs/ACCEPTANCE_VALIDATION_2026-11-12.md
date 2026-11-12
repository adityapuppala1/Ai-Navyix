# Navyix acceptance increment — validation, 12 November 2026

Reviewed repository base: `main` at `8e0a2497f0a63d800499217d9bdefaa3299bb8c3`.
Publishing status: prepared locally; NOT committed or pushed in this session.

## Implementation

- Manual disposable-PostgreSQL integration runner and restricted environment/cleanup helpers.
- 13 additional live two-organization workflow, RBAC, RLS, concurrency and history scenarios.
- Transaction-conflict classification handles PostgreSQL SQLSTATEs inside Prisma raw-query `P2010` errors.
- No authentication bypass, default credential, fabricated lockfile, automatic CI trigger or deployment change.

The original `packages/server/src/service.mjs` was reconstructed from the connector response and verified
byte-for-byte with Git blob `aa85cecb82f62222601170aceb8558535feb1c18` before the small change was applied.

## Executed

Environment: Linux authoring container, Node.js v22.16.0. npm/GitHub DNS was unavailable; no installed pnpm,
Next/Nest/Prisma/JOSE/pg packages, PostgreSQL server or Docker daemon was available. The connected development
computer was offline. Only a focused working copy was assembled, not a complete installed repository checkout.

Command:

```sh
node --test scripts/test/integration-lab.test.mjs packages/server/test/transaction-errors.test.mjs
```

Result: **82 tests, 82 passed, 0 failed, 0 skipped**.

- 63 runner/preflight/security/error-path checks. Docker and dependency operations are injected TEST DOUBLES.
  The subprocess wrapper checks actually launch local Node processes for output/stdin, missing executables,
  timeouts and pre-aborted execution. These tests do NOT start Docker or execute database SQL.
- 19 pure transaction-error classification checks. They test recognized and unrecognized code shapes.
  They do NOT reproduce a live database serialization conflict or prove full API behavior.
- `node --check` on all seven JavaScript implementation/test files: passed.
- Strict live-suite invocation with NAVYIX_REQUIRE_INTEGRATION=1: exited 1 as intended because the disposable
  database is unavailable. It was NOT counted as a passing integration test.
- Lab --run preflight in the focused working copy: exited 2, created no resources. Missing source-file entries
  in that scratch report describe this partial working copy, NOT missing files in the GitHub repository.

## Not executed / not established

- The 13 new live PostgreSQL acceptance scenarios.
- Actual Docker creation, migrations, cleanup or image compatibility.
- Existing real JOSE integrations and real restricted-session SQL tests.
- Full Next.js/NestJS build/typecheck/lint, dependency audit, lockfile or generated Prisma client.
- Live provider sign-in, browser-session behavior, rendered two-organization browser workflow.
- Windows/macOS execution, visual/accessibility/browser compatibility, load/security/recovery acceptance.
- Full existing server/policy/workflow/browser regressions. Their prior reported counts are not added here.

The live suite, when executed, uses two independent restricted database connections for conflicting edits,
not only two promises serialized through one connection pool. A service error returned instead of the expected
409 remains a failed acceptance assertion; the test does not silently accept an arbitrary failure.

## Operational boundaries

The runner never dispatches CI, commits, pushes, creates a repository branch, installs packages, pulls an image,
provisions cloud infrastructure, changes a customer database or enables the browser/backend by default.
`--run` is explicit consent to create/migrate a new disposable local database, not consent to deploy.
Missing prerequisites, skipped tests, cleanup errors and interrupted runs cannot become a passing live result.

The downloaded package has an installer that checks the intended repository, main branch, reviewed base,
clean working tree, original-file identity and checksums before applying. It leaves changes uncommitted.
Fourteen installer checks passed against temporary Git repositories: read-only validation, exact application,
unchanged branch/HEAD/index, dirty/staged work, wrong repository/branch/base, changed original content, corrupt
patch/source, traversal/duplicate paths, existing ignored paths, and wrong-root rejection. The fixture manifests
use their own temporary base commits; no live GitHub repository was modified. These are not product acceptance tests.

## Next acceptance gate

Apply/review this increment on main; resolve and review real dependencies and lockfile; execute the disposable
lab and full build on a network-enabled development machine. Fix any actual failures, then perform real provider
login and rendered two-organization browser tests before enabling a controlled customer pilot.
