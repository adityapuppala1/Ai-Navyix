# Save recovery validation — 12 November 2026

Reviewed base: main at `11691af5780bf0ad53be69c45cf159760dc6145a`.

## Reproduced defects

Using the exact current client sources (matched to Git blob hashes), local reproductions showed:

- The invitation client dispatched one further request after its session generation changed; the original generation was only checked after the response.
- The main workflow client had the same pre-dispatch gap.
- The workflow client accepted a success response with a different project, request ID and revision, then discarded its pending original request.

These were synthetic transport reproductions, not reported customer incidents or demonstrated unauthorized database access. Backend access controls were not bypassed. The patch checks context before sending and correlates workflow receipts before clearing pending state.

## Executed

Environment: Linux working container, Node 22.16.0, Python Playwright with system Chromium. Registry and public Git DNS probes failed. The connected development device was offline. No installed Next/Nest/Prisma runtime, PostgreSQL or Docker was available. This is a sparse, hash-verified source workspace, not a complete checkout.

Final Node command:

```sh
node --test packages/browser-session/test/client.test.mjs packages/browser-session/test/write-recovery.test.mjs packages/browser-session/test/invitation-recovery.test.mjs
```

**69 tests passed; 0 failed, cancelled, skipped or TODO.**

- 18 existing browser-workspace regression cases: cookie transport, CSRF, revision conflicts, retry preservation, stale responses, session expiry, four-stage readiness target matching and failed-refresh handling. The previous test module was reconstructed and matched to blob `7ad550e9a7a970ba4be15127f76908a782d3ea2f`; only its import of three identifier constants was replaced with those same local constants so these client tests do not eagerly load an unrelated server handler.
- 36 new workflow save-recovery cases: exact acknowledgement target/revision/key, invalid acknowledgements, context checks before dispatch, shared in-flight retries, immutable JSON, HTTP outcome handling and late responses after context changes.
- 15 new invitation-recovery cases: current-session directory/preview requirements, pre-dispatch retry checks, concurrent retry sharing, failed directory reloads, discarded stale previews, immutable pending payloads and stale-response isolation.

The earlier 51-test run contains the same new cases; it is not added again to the final count. Tests use the actual client modules with synthetic Fetch responses or test transport. They do not execute the database, provider login or deployed browser session.

Browser command:

```sh
python tests/invitation_recovery_browser.py --artifacts test-results/invitation-recovery
```

**22 offline Chromium checks passed; 0 uncaught page errors.** The actual invitation component, client, BrowserWorkspace and existing CSS are exercised with synthetic API/session records. Checks cover original-request retry, blocked in-page navigation, conditional unload-handler registration/removal, synthetic pagehide/pageshow, denied refresh after a confirmed creation, late refresh after sign-out and component reconnection. No horizontal page overflow at 360/390/768/1440 px. The recovery screenshot was visually inspected and is labeled synthetic.

Lifecycle events are dispatched by the harness; this is not actual bfcache traversal or proof that the browser will display a native exit warning. No real clipboard permission or mail delivery is tested. The fake provider/storage is not the real invitation state machine.

All changed JavaScript modules/tests passed Node syntax checks. No TypeScript source was changed. The current stylesheet was reused unchanged after matching blob `088416c617e828a9b72613e2be810c1a19348675`. The three edited runtime originals matched blobs `4c062de11407d23180bef77c05ccf2f9759b1899`, `423eb08538bcdf92f7cca453da7879d3d75532ce`, and `c319b6d737f7b23ba8440dc94944835bd121c74b` before editing.

## Unpassed gates

No genuine lockfile or dependency audit, full-workspace/policy/core-workflow/server regression, semantic typecheck, lint, Next/Nest/container build, Prisma generation/validation, migration, actual PostgreSQL/RLS/concurrency or JOSE/provider login was executed. The unchanged core-workflow suite is unavailable in this sparse source copy and is not counted as passed. No real-origin connected-browser acceptance, Firefox/WebKit/OS matrix, screen-reader, load, recovery or penetration test is claimed.

No dependency manifest, database migration, server permission, readiness rule, feature default or GitHub Actions definition changed. No workflow dispatch, email, customer data collection or deployment was performed. The next acceptance gates remain the complete application build and real two-organization identity/database/browser validation, not another claim that mocked checks make the application production-ready.
