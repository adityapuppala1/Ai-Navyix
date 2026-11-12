# Browser-session increment validation — 11 November 2026

> Historical package-only validation. For the resumed implementation and current results,
> see [VALIDATION_2026-11-12.md](VALIDATION_2026-11-12.md).

Baseline reviewed: `main` at `e159bd52fb3c392358cc7a0f758055db0b15bed5`.
Delivery status: prepared as a local patch/package. No GitHub commit or push was performed in this turn.
The exposed GitHub tools offered reads but no write/commit operations; no authenticated CLI was available.
No branch, workflow, database, provider account or cloud resource was created or changed.

## Executed

Environment: Linux, Node.js v22.16.0. npm registry DNS lookup failed. No installed Next/Nest/JOSE/pg
packages or live PostgreSQL service were available.

`node scripts/test-browser.mjs`: **110 tests total: 108 passed, 0 failed, 2 skipped**.

- 58 configuration/session/CSRF/forwarding checks use the real Fetch handler and real Node AES-GCM,
  random generators and SHA-256/PKCE calculation, with test-only session storage and an OIDC exchange double.
- 25 OIDC exchange/claim-policy checks use an injected JOSE verifier double. They are NOT signature tests.
- 12 browser transport tests cover cookie-only calls, exact retries, conflicts, organization switching,
  late responses, revision-matched readiness, expiration, logout and acknowledged-save refresh failures.
  They execute the browser adapter under Node, not the rendered web component in a real browser.
- 12 PostgreSQL repository/migration-contract tests inspect parameterized queries, startup privilege
  guards, atomic-consumption query structure and additive SQL. They are NOT live database tests.
- 1 real loopback HTTP round-trip test exercises login callback, cookie session, backend forwarding and
  logout across two HTTP servers. OIDC, sessions and upstream business responses remain test fixtures;
  this is NOT a Next.js/NestJS/live identity-provider end-to-end test.

`node scripts/test-browser.mjs --integration`: **exit 1, 2 failing prerequisite gates**, as intended when
JOSE and a migrated disposable PostgreSQL database are unavailable. This gate did NOT pass.

Additional source checks: `node --check` passed for new JavaScript modules. TypeScript
`transpileModule` reported no syntax diagnostics for the web session factory, API route and workspace
page; the declaration file parsed without syntax errors. These are syntax checks, NOT semantic
typechecking or framework builds.

The existing server `auth.mjs` and `errors.mjs` used by the tests were copied from the reviewed commit
and verified byte-for-byte against Git blob SHAs `a6e3eb3820d1fdb0e2b368e35bb59127fef946fc`
and `7272ecdb10e7a760010b7e1bcb24d67417f0b271`. Neither is changed by the patch.
The seven original files modified by the patch were likewise verified against their GitHub blob hashes.

## Not executed / not established

- Real JOSE integration: explicitly skipped. Live issuer/JWKS connectivity and real provider login are unverified.
- Real PostgreSQL session-role integration: explicitly skipped. No migration was applied.
- Full dependency installation, lockfile generation, dependency audit, semantic typecheck, ESLint,
  Next/Nest builds and Docker builds are not completed.
- The connected native component is coded and its transport tested, but the inherited complete UI,
  actual Next route, browser cookies, downloads, layout/accessibility and cross-browser behavior have not
  been exercised together in this increment. Existing local-workbench screenshots are not evidence for it.
- Earlier policy/workflow/server suites were not reexecuted here. Their existing sources are unchanged.
- No claim of production readiness, complete isolation, certified security or all-device compatibility is made.

Both browser/backend feature flags remain disabled by default. Follow BROWSER_WORKFLOW.md and the
previous server guide to complete the real acceptance gates before any customer pilot.
