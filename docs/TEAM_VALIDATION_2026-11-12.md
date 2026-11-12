# Navyix acceptance and project-team validation — 12 November 2026

Base: main at 8e0a2497f0a63d800499217d9bdefaa3299bb8c3.
This increment incorporates the previously uncommitted nine-file acceptance package and adds opt-in existing-member project access management. No dependency manifests or GitHub workflow definitions are changed.

## Executed

Environment: Linux working container, Node 22.16.0, Python Playwright with system Chromium. npm/Git DNS unavailable; no Docker, PostgreSQL, pnpm or installed application dependencies. Authorized remote development device remained offline.

1. `node --test scripts/test/integration-lab.test.mjs packages/server/test/transaction-errors.test.mjs packages/server/test/team.test.mjs packages/server/test/team-http.test.mjs packages/browser-session/test/team-client.test.mjs packages/browser-session/test/team-proxy.test.mjs`: **177 tests, 177 passed, 0 failed, 0 skipped**.
   - Includes the acceptance package's 82 checks, team service/repository/migration contracts, actual loopback HTTP handlers with test repository/identity, BFF permission checks, and browser-client response/retry validation.
   - Database authorization statements were inspected, not executed against PostgreSQL. Docker orchestration was simulated. These do not prove tenant isolation.
2. Current committed browser-session client, session, HTTP, OIDC and PostgreSQL-contract test files: **114 tests, 114 passed, 0 failed, 0 skipped**. The five test-file Git blob hashes were matched against current main before accepting the results. Dependencies for real JOSE/database integration are not involved in these tests.
   - An initial attempt used older ZIP client fixtures: 12 failed due to obsolete fixed expiry/scope fields. Replacing that test file with the exact current main source (hash 7ad550e9a7a970ba4be15127f76908a782d3ea2f), without changing application behavior or weakening assertions, resolved this mismatch. The other 96 checks passed in both attempts.
3. `python tests/team_browser.py --offline`: **26 assertions passed, 0 uncaught browser JavaScript errors**. Exact new component/client/CSS with synthetic API and cross-tab channel. Checks include protected owner/self, role ceilings in UI, confirmation and cancellation, grant, uncertainty after a committed save, identical retry, revoke, denied refresh, cross-tab sign-out, and no page-level horizontal overflow at 360/390/768/1440 px.
4. Changed/new JavaScript syntax and TS/TSX transpilation syntax checked separately. Transpilation is NOT semantic typechecking or a Next/Nest build.
5. Strict `NAVYIX_REQUIRE_INTEGRATION=1 node --test packages/server/test/team-live.test.mjs` exited nonzero when disposable database settings were absent, as required. This is a BLOCKED gate, not a passing database test.
6. Integration-lab preflight reported missing prerequisites without provisioning anything.

Totals: **291 passing Node checks across the two successful commands**, plus 26 offline browser assertions. No full repository regression claim: unchanged policy/workflow/server suites were not re-executed from this sparse local checkout. The full regression run remains required by the repository acceptance gate.

## Not executed / limitations

- Browser HTTP navigation was blocked (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). The explicit offline harness is not a real-origin or deployed browser test and did not bypass that policy.
- No real SQL migration, SECURITY DEFINER execution, RLS, database concurrency, or live role grant/revoke result. Nine nested live team scenarios are written but NOT executed.
- No real JOSE/JWKS or hosted identity login, cookie/CSRF end-to-end browser test, pnpm install/lockfile, Prisma validation/client generation, full typecheck/lint/framework/container build.
- No Firefox/WebKit/OS matrix, automated accessibility audit, load/security penetration/recovery acceptance.
- Existing Next workbench behavior was not re-rendered with live backend. Readiness domain is unchanged. Manually recorded evidence remains advisory/unverified.
- No customer database, deployed application, cloud resource or CI job was changed by validation.

Both backend/browser features and the new TEAM flag remain off by default. Enable only in an isolated development environment after the documented actual gates pass. See PROJECT_TEAM.md and ACCEPTANCE_LAB.md. Old validation files remain historical records, not cumulative proof of production readiness.
