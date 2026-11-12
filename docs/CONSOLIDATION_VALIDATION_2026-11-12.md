# Startup, container and database-shape validation — 12 November 2026

Reviewed base: main at d0f0d6cf259383d270272ca6de69983c3c94a241.

## Changes and evidence

The browser runtime now shares initialization, bounds retries after startup failure, and does not discard a successful handler/pool when one request throws. Provider setup is done before allocating the pool; unsuccessful store/handler initialization closes it. Docker build contexts exclude local secrets/output and registry configuration. Both Dockerfiles now require a genuine lockfile and frozen installation; no lockfile was invented. An additive migration replaces nullable workflow/snapshot shape predicates with explicit-true checks, after validating existing rows. No existing migration was edited. The existing disposable lab includes the new live shape suite.

These are source fixes and a delivery plan, not a full application-build or production-acceptance pass.

## Executed

Environment: Linux working container, Node v22.16.0. npm and public Git DNS resolution failed; the connected Desktop Commander device was offline. No pnpm, installed application dependencies, Docker daemon or PostgreSQL server was available. Repository originals were read via the authorized connector; reused archive copies were accepted only after matching current Git blob hashes. This is a sparse source workspace, not a full checkout.

Command:

```sh
node --test packages/browser-session/test/runtime.test.mjs scripts/test/deployment-boundaries.test.mjs packages/server/test/workflow-shape-contract.test.mjs packages/server/test/workflow-shape-live.test.mjs scripts/test/integration-lab.test.mjs
```

Result: **90 tests, 89 passed, 0 failed, 1 skipped**.

- 16 runtime tests execute the new resource lifecycle using real JavaScript promises and Fetch Request/Response objects, with injected initializer/request functions. They test concurrent initialization, request errors, retry cooldown, redaction, disablement and event logging. They do not allocate a real PostgreSQL pool.
- 7 packaging/entry-point contract tests inspect Docker ignore patterns, frozen-install configuration, code-generation configuration, cleanup scope and unchanged TLS/role requirements. These do not execute Docker's pattern matcher or build images.
- 3 migration-text tests inspect atomicity, explicit-true predicates, validation-before-replacement and the absence of data repair/grant changes. They are not SQL execution.
- 63 existing disposable-lab regression tests pass against the updated suite list. Container operations are simulated; the existing subprocess/report-protection test executes real Node code.
- 1 live PostgreSQL group is skipped. Its 22 nested scenarios are prepared but NOT executed: missing/null/wrong JSON fields must be rejected, and the two valid records must remain unchanged. Tests run in a transaction rolled back afterward and require a migrated disposable database.

Strict `NAVYIX_REQUIRE_INTEGRATION=1 node --test packages/server/test/workflow-shape-live.test.mjs` exited 1 because the explicit database prerequisites were absent. This is a blocked gate, not success. Lab preflight exited 2 without provisioning resources. JavaScript syntax checks passed. TypeScript transpilation of apps/web/lib/browser.ts reported no syntax diagnostics; this is not semantic typechecking.

During development, one SQL-fixture quoting syntax error was corrected to a bound role parameter. A first lab-regression run lacked the unchanged CLI entry file in the sparse workspace; restoring its exact current Git blob resolved the setup failure without changing assertions. Final counts above are from the successful combined run, not accumulated repeated runs.

## Not executed

No dependency install/audit/lockfile generation, full-workspace/domain/browser regression, actual ESLint, semantic typecheck, Prisma validation/client generation, Docker build/image inspection, SQL migration or constraint execution, real restricted-role/RLS/JOSE acceptance, live IdP/GitHub/model request, or rendered Next browser test. Unchanged workflow tests were unavailable in this sparse workspace and are not counted as passing. No screen changes or screenshots are claimed.

No customer database, cloud resource, branch or deployment was created. No workflow was dispatched. All application feature flags stay off by default, and no GitHub Actions definition changes are included. Future work follows DELIVERY_PLAN.md: actual reproducible builds, database acceptance and connected browser journeys precede further feature expansion.
