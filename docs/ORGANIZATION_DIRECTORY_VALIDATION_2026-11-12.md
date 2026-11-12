# Organization-directory validation — 12 November 2026

> Historical record of the earlier, uncommitted package. The subsequent integration and current validation results are recorded in `ORGANIZATION_DIRECTORY_INTEGRATION_2026-11-12.md`.

Base inspected: main at b42db2c8af9f4ae06fc6e29fbd2dd42bdb86850e.
Prepared locally; no commit, workflow dispatch, migration, provider call or deployment was performed.

## Executed

Linux working container, Node 22.16.0, Python Playwright and system Chromium. The package registry cannot resolve; the authorized remote machine is offline. GitHub read access is available but no create/commit/push operation is exposed in this session. This is a partial source workspace, not a complete checkout.

- `node --test packages/server/test/directory*.test.mjs packages/browser-session/test/organization-client.test.mjs`: 86 tests, 85 passed, 0 failed, 1 skipped live database group. Tests cover service input/projection/paging, fixed SQL and transaction context contracts, actual loopback HTTP with test identity/storage, same-session browser directory state, stale responses and read-only proxy-route validation. They do not execute PostgreSQL policies or real JOSE.
- Strict live invocation with NAVYIX_REQUIRE_INTEGRATION=1 exits 1 when disposable database prerequisites are absent. This is a blocked gate, not a pass. The group's nine nested database scenarios remain unexecuted.
- `python tests/organization_directory_browser.py --offline`: 16 passing component assertions, no uncaught browser errors. Exact new picker/client source runs in an offline harness with synthetic memberships/transport. Checks include keyboard selection, loading, pagination, denied refresh, empty state, literal rendering of hostile-looking text, session-context changes, older responses and no page-level horizontal overflow at 360/390/768/1440 pixels. Screenshots are component-harness results, not a deployed application.
- Package installer tests: 15 passed. These test exact-source transformation, CRLF preservation, base/anchor rejection, unsafe paths, writes and concurrent-change refusal. They are not a claim that the installer has run against the real GitHub checkout. At application time the installer also verifies repository identity, main, the reviewed HEAD and a clean working tree before validating all modifications.
- The current connected.mjs was reconstructed from the earlier source archive and committed changes; its exact Git blob hash f475d5211ff41793675d032de0bb0ec75e12ba36 was verified before applying the UI integration edits. The modified module passes Node syntax checking. A first reconstruction omitted already committed lifecycle lines; the hash check caught this, and those lines were restored before testing the patch.
- Browser config test dependency was matched to blob dea53148ebeeab97a8174e0146f22c1176fefff6; the existing error helper matches blob 7272ecdb10e7a760010b7e1bcb24d67417f0b271. Neither is included as an application change. All edited originals have exact base blob IDs in the installer manifest; each replacement must match a unique anchor or application stops.
- New JavaScript syntax checks passed. The source for the new organization service, route, component and tests uses no added package dependencies.

One initial UI-test fixture returned an assigned function to Playwright evaluation, causing the harness to invoke it. The assignment was changed to a statement-only wrapper. Assertions were not weakened; the successful rerun is the reported browser result.

## Not executed

The complete Next.js/NestJS application has not compiled. No real dependency lockfile was generated. Semantic TypeScript, ESLint, Prisma migration/validation, real RLS or connection-pool behavior, hosted identity login, complete browser session proxy integration, cross-organization deployed browser flow, or full workspace/workflow regression was run. The route helper is tested; the existing full BFF is not rerun in this partial workspace. No Windows/macOS, Firefox/WebKit, accessibility audit, load, recovery or penetration testing is claimed.

The source package contains guarded integration edits for the exact reviewed commit. It intentionally refuses a different HEAD, changed originals or uncommitted local work; do not reset local work to force it. It leaves successful changes uncommitted and does not install dependencies, enable feature flags, apply a migration, or execute GitHub Actions. Runtime flags stay off. The main repository remains at its previously verified commit until these changes are applied and separately committed.
