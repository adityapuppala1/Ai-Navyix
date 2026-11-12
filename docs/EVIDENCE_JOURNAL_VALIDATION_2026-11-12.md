# Saved evidence history validation — 12 November 2026

Base reviewed: `main` at `9a5d9937516200e48d4f30a3e649ca39697c9866`.

## Executed in this increment

Environment: Linux container, Node v22.16.0, Python Playwright with system Chromium, installed TypeScript transpiler. `registry.npmjs.org` DNS resolution failed again. No pnpm, PostgreSQL server, Docker daemon or application framework dependencies were available.

1. `node --test packages/server/test/journal*.test.mjs packages/browser-session/test/journal*.test.mjs`: **102 tests: 101 passed, 0 failed, 1 skipped**.
   - 55 service checks: capture scope, current revision/build, no readiness mutation, authorization/revocation before and after collection, replay, changed request IDs/payloads, canonical integrity, paging, pilot cap, collector-output rejection and transaction rollback using a test repository.
   - 13 repository/migration contract checks: fixed parameterized SQL, transaction-local context, startup restrictions, RLS/grants and shape constraints. These are NOT executed PostgreSQL.
   - 12 actual loopback HTTP handler checks using synthetic identity and storage.
   - 14 browser-client checks using the existing BrowserWorkspace with synthetic API responses: strict target/ack validation, uncertain-write retries, stale responses, revocation, session expiration and historical labels.
   - 7 existing-session-proxy route/CSRF checks with synthetic provider/session/upstream.
   - 1 live PostgreSQL test group skipped because the disposable database was unavailable. Its six nested SQL acceptance scenarios were NOT executed.
2. Existing browser-session session/HTTP/OIDC policy tests: **84 passed**. These exercise current session/proxy/claim-policy code; not live provider login or cryptographic signature verification.
3. Existing disposable-lab/conflict tests: **82 passed** after adding the new live suite to the explicit runner. Docker operations are simulated; no container was provisioned.
4. `python tests/journal_browser.py`: **21 offline Chromium assertions passed, 0 uncaught page errors**. Exact component/client code with synthetic APIs and CSS embedded by the harness. Covers empty state, explicit capture confirmation/cancel, lost acknowledgement after a simulated commit, identical retry, one saved item, historical revision label, literal rendering of untrusted markup, denied refresh, sign-out, and no horizontal overflow at 360/390/768/1440 px. Screenshots were visually inspected.
5. Changed/new JavaScript syntax checked; TS/TSX transpileModule reports no syntax errors in API startup and both Next pages. Transpilation is NOT semantic typechecking or a framework build.
6. Strict `NAVYIX_REQUIRE_INTEGRATION=1 node --test packages/server/test/journal-live.test.mjs` exited 1 as required with no disposable database. This is a BLOCKED gate, not a pass.
7. Attempting the unchanged workflow test glob in this sparse checkout discovered **zero tests**. It is NOT counted as regression validation. The new explicit journal runner fails when its required test source files are missing.
8. Modified originals were reconstructed/read and checked against the current Git blob hashes before editing. Current BrowserWorkspace and authentication helpers were likewise matched before reuse. No existing readiness rules were modified.

Combined successful scoped commands: **267 passing Node tests**, with one skipped live test group, plus 21 offline browser assertions. These are not a full-repository release result.

## Corrections made during implementation

- A corruption-test fixture initially mutated a stale object after a test transaction replaced its state. The fixture was corrected to alter the active state; application integrity assertions were not weakened.
- The new screen's submit handler was narrowed so the existing login form keeps its normal POST navigation. Confirmation starts on Cancel, and the retry action remains accessible after an uncertain save.
- A denied record read now clears previously displayed summaries. UI task generations prevent detached/sign-out responses from changing a newer screen.

## Not executed and still required

No actual SQL migration, RLS evaluation, Prisma schema validation/client generation, JOSE signature integration, live GitHub call, hosted identity-provider sign-in, full Next/Nest typecheck/lint/build/container build, or actual two-organization deployed browser test. No real-origin session-cookie acceptance, Firefox/WebKit, manual screen-reader audit, load, distributed-quota, recovery or penetration test. The unchanged policy/workflow/full server suites were not rerun from a full checkout.

All flags stay off by default. No customer data/source was collected, database was migrated, cloud resource created, workflow dispatched or application deployed in validation. Existing CI definitions and dependency manifests remain unchanged. Production evidence ingestion, artifact attestation and test-report association remain subsequent work.
