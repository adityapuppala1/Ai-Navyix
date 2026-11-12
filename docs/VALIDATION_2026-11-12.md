# Resumed connected-workspace increment — 12 November 2026

Baseline: main at e159bd52fb3c392358cc7a0f758055db0b15bed5. This increment incorporates
and improves the browser-session package previously supplied as a ZIP. The earlier
BROWSER_VALIDATION_2026-11-11.md is a historical record, not the current publishing status.

## Product changes

- The existing Design -> Build -> Test -> Readiness workbench gains opt-in browser sign-in,
  server-held encrypted sessions, and server persistence through the existing authorized API.
- Context-generation checks reject all late responses from an earlier organization/session,
  including errors. A stale failed write cannot erase a newer pending request.
- Readiness responses must match project revision, stage, environment, build ID and digest.
  Explicitly selecting no build remains consistent after refresh or a save.
- An uncertain save keeps its original idempotency ID and payload. Retry is accessible inside
  the open modal; ordinary resubmission and field editing are disabled until the outcome resolves.
  The user can close the dialog and retry from the page. A before-unload warning covers pending writes.
- Access-denied reads clear rendered project data and offer organization-switch recovery.
- A manual-only local verifier checks prerequisites before running builds/integrations. It does
  not install packages, mutate databases, invoke CI, create branches, push or deploy.

## Checks actually executed

Environment: Linux, Node.js 22.16.0, Python Playwright and Chromium. Network DNS to npm/GitHub
is unavailable from the shell. Repository reads/writes use the authorized GitHub connector.
No Next/Nest/JOSE/pg installation, PostgreSQL server, Docker daemon or live identity provider
was available. Code was tested in a reconstructed source subset with verified unchanged imports,
not a full installed repository checkout.

1. `node scripts/test-browser.mjs`: **125 tests; 123 passed; 0 failed; 2 skipped**.
   This comprises the earlier session/configuration/HTTP/repository-contract/OIDC-policy tests,
   18 client-transport tests (including six new regression cases), and nine verifier tests.
   Session cryptography uses real Node AES-GCM; provider identity and storage remain test doubles.
   OIDC policy tests mock signature verification. Repository checks do not execute PostgreSQL SQL.
2. The six new client regressions were first observed failing against the previous client and
   then passed after the fixes. They cover stale errors, pending-write races, exact readiness
   target validation, no-build selection, and malformed session expiration.
3. `node --check` passed for the browser-session modules, scripts and test fixture modules.
4. `python tests/connected_workflow.py --offline`: **22 checks passed; zero uncaught page errors**.
   It exercises the real connected component, inherited workbench views, transport and shared
   workflow domain with a synthetic in-memory API. The journey covers creation, requirement/design
   review, build/test records, failed result, passing retest, snapshot, requirement invalidation,
   idempotent modal retries, retained no-build selection, organization switching and revocation.
5. `node scripts/test-browser.mjs --integration`: **exit 1**, two failed prerequisite gates.
   Real JOSE and PostgreSQL gates did not pass; strict mode correctly refuses to skip them.
6. `node scripts/verify-workspace.mjs --full`: **exit 2, blocked**, because the real lockfile
   and installed dependencies are absent. No build subprocess was started. Its command planning,
   explicit integration flag, prerequisite blocking and stop-on-failure behavior have unit tests.

## Browser test boundaries

The normal online harness was attempted. Browser navigation to the local HTTP origin was
blocked with ERR_BLOCKED_BY_ADMINISTRATOR. It was not bypassed. The separately declared offline
mode uses an about:blank document and inline copies of the reviewed application modules.

Offline mode has no real cookies, login redirect, provider, database, HTTP module serving,
Next/Nest integration or back-forward cache verification. It uses a test-only randomUUID
substitute for the opaque browser origin. Download payloads are captured, not actual downloads.
Stylesheet links are removed in that harness, so these results do not establish visual quality,
responsive layout, contrast, accessibility, or Three.js behavior. The test fixtures are not
production fallbacks and are not copied into the application build.

The optional online fixture tests a synthetic OIDC/BFF pair on loopback, not a real identity
provider or customer API. It requires NAVYIX_TEST_HARNESS=1, rejects production mode and never
connects to a customer database. A real deployment acceptance run is still required.

## Unchanged source provenance

The following imported sources were compared with their existing Git blob hashes:

- packages/server/src/auth.mjs: a6e3eb3820d1fdb0e2b368e35bb59127fef946fc
- packages/server/src/errors.mjs: 7272ecdb10e7a760010b7e1bcb24d67417f0b271
- apps/web/workbench/app.mjs: 4d79d9be7e54d0f81130131a9437b644c696f82d
- packages/workflow/src/workflow.mjs: c70e13312f530ed33a3bf47ee3feb02178cee427
- packages/workflow/src/storage.mjs: 842b6c7a855d64269e2dfe678cf3c3c26d7f9505

Existing server/policy/local-workflow regression suites were not reexecuted in this increment.
No source from those domains was changed. Full typechecking, linting, framework/container builds,
dependency audits and live database/identity verification remain outstanding.

## Release gate

Both NAVYIX_BROWSER_ENABLED and NAVYIX_API_ENABLED remain false by default. No real tenant data
was imported, no migration or cloud deployment was performed, and no workflow was dispatched.
Do not enable customer access based solely on these results. Resolve dependencies and review a
real lockfile, pass real database/JOSE integration and full builds, then validate two-organization
browser journeys, role enforcement, cookies, recovery, load and security before a pilot.
