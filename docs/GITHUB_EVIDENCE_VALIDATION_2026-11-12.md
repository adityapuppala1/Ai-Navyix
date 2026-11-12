# GitHub evidence inspection validation — 12 November 2026

Base: `main` at `2e0852b9e822a0315b32d7ad5c45b6680539958e`.

## Implemented scope

An opt-in, read-only inspection route and responsive `/workspace/evidence` screen for the existing Design / Build / Test / Readiness application. Operator-approved repository ID/name, workflow IDs, event types and exact job names are bound to one tenant/project. The selected recorded build supplies the expected commit. Source run/attempt/job metadata is collected with GET only. It is neither imported into test results nor used to mutate readiness. No new dependencies, database migrations, CI triggers or automatic source synchronization were introduced.

## Executed

Environment: Linux container, Node 22.16.0, system Chromium via Python Playwright, installed TypeScript transpiler. The npm registry hostname could not resolve; pnpm, Docker and PostgreSQL were unavailable.

1. `node --test packages/server/test/github*.test.mjs packages/browser-session/test/evidence*.test.mjs`: **123 passed, 0 failed, 0 skipped**.
   - 77 configuration/collector checks: source/commit/attempt matching, fork rejection, required jobs, skipped/cancelled/failure states, absent timestamps, bounded complete pagination, duplicate rows, changing metadata, authorization before/after retrieval, conflicts, redirects, upstream errors, rate limits and per-process concurrency.
   - 8 actual local Node HTTP handler tests with test identity and inspection adapters. No live PostgreSQL or GitHub request is made by these tests.
   - 25 browser evidence-client tests with synthetic API responses, target validation, stale-context suppression and clearing old observations.
   - 13 browser-session proxy tests with synthetic identity/storage/upstream, GET-only restrictions, argument restrictions, redacted upstream errors and retained behavior for other routes.
2. Existing session, OIDC-policy and HTTP regression files: **84 passed, 0 failed, 0 skipped**. Their Git blob hashes matched the previously retrieved repository versions. The reused config, cryptography, OIDC and current BrowserWorkspace modules were also matched to GitHub blobs. This is not cryptographic verification against a live provider.
3. `python tests/github_evidence_browser.py --offline`: **23 checks passed, 0 uncaught JavaScript errors**. Exact component/client/CSS embedded in an offline page, with synthetic APIs and broadcast events. Verified project/build selection, exact run link, metadata/proof distinction, skipped jobs, mismatch rejection, markup escaping, rate-limit display, no automatic retry/polling, access-denied clearing and sign-out during an in-flight request. No page-level horizontal overflow at 360/390/768/1440 px.
4. New/modified JavaScript syntax checked. TypeScript/TSX transpileModule syntax diagnostics for API startup and both Next pages: no errors. This is not semantic typechecking or a framework build.
5. Seven modified originals were checked against their current Git blob hashes before editing. Other changes are new files. Existing workflow and database source were not modified.

Combined: **207 passing Node tests**, plus **23 offline Chromium checks**. Counts are scoped to the commands above, not a full-repository release pass.

## Issues corrected during this work

- The first proxy-suite invocation lacked an unchanged auth module in the sparse working copy. Restoring the exact existing GitHub version fixed the test setup; no authentication bypass was introduced.
- The first rendered check exposed an ambiguous accessible label on a select. Explicit labels and focus restoration after asynchronous requests were added; the rendered checks passed afterward.
- Component reconnects no longer accumulate root event listeners. Provider backoff timestamps are retained rather than shortened to a local one-day ceiling.

## Not executed / remaining gates

- Real GitHub HTTP/token connectivity, App installation/rotation, a live customer's repository binding, or real multi-attempt provider observations. External responses in the collector tests are fixtures.
- Full pnpm resolution and a real reviewed lockfile, dependency audit, Prisma generation/validation, TypeScript semantic checks, ESLint, Next/Nest/container builds.
- Live OIDC sign-in, real browser-origin cookie behavior, PostgreSQL/RLS and two-tenant application end-to-end acceptance. No new migration exists in this increment.
- Complete unchanged policy/workflow/server regression suites from a full checkout, live DB acceptance lab, Firefox/WebKit, manual screen-reader audits, load testing, distributed quotas, recovery or penetration testing.
- No live source was connected, no customer data was collected, no GitHub workflow was dispatched, no deployment or cloud/database operation was performed.

The inspector remains disabled by default. Its export is unsigned/editable, and job metadata does not establish artifact identity, test coverage or release readiness. See `GITHUB_EVIDENCE.md` for configuration, limitations and the required live acceptance checks.
