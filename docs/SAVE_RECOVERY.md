# Save recovery and onboarding acceptance

This increment hardens the existing Design / Build / Test / Readiness workspace and invitation onboarding. It introduces no new feature flag, dependency, database migration, mail delivery, AI provider, or CI trigger.

## What changes

The workflow client checks the active session generation, organization and selected project **before** dispatching an original-request retry. Invitation creation/revocation requires a successfully loaded current-session directory; acceptance requires a preview from the current session. An earlier account's pending request is not automatically sent under a new context. These client checks supplement—not replace—the existing backend identity, RBAC, recipient verification and transaction checks.

Workflow acknowledgements must match the original request ID, expected next revision, and selected project. Project creation must return a valid server-assigned UUID at revision one. A malformed or mismatched success response leaves the original request unconfirmed. Retrying uses its original JSON snapshot and idempotency key, not a newly generated submission.

Concurrent retry calls share one in-flight operation. Payload snapshots cannot be edited through the pending-state object. Network failures, malformed success responses, HTTP 408 and HTTP 429 remain unconfirmed. Definite validation/permission/conflict responses can clear the pending request so the user can resolve the problem. A confirmed receipt followed by a failed refresh stays confirmed; it does not become another creation.

The invitation screen blocks its own workspace links while an invitation write is unconfirmed and keeps the original retry control available. It attaches a beforeunload handler only while needed and removes it after resolution/sign-out/disposal. On a persisted pageshow it clears sensitive in-memory state and checks the server session again; it never replays an invitation automatically. A denied refresh after an acknowledged creation clears the issued code and disables creation until access is re-established. Late refresh/clipboard completions cannot update a newer signed-out screen.

## Important boundaries

Client-side state is not an authorization boundary. A request already dispatched may commit even if the client later disconnects or signs out. Cancelling navigation or rejecting a stale retry does not undo an earlier operation. A returned acknowledgement is matched to the application contract, not independently signed evidence or proof of release readiness.

Browser exit events are not guaranteed, particularly on mobile. A browser may ignore the unload warning or terminate the process. Pending request IDs and invitation codes remain in memory; they are **not** persisted to localStorage. After a forced reload/exit, reconcile project history or invitation history in the original authorized account before starting another operation. Do not claim exactly-once execution across browser termination.

The offline browser tests dispatch lifecycle events to test our handlers. They do not establish actual back/forward-cache entry/restoration, native warning delivery, clipboard permissions, live cookie behavior or cross-browser compatibility.

## Commands

```sh
node --test packages/browser-session/test/client.test.mjs packages/browser-session/test/write-recovery.test.mjs packages/browser-session/test/invitation-recovery.test.mjs
python tests/invitation_recovery_browser.py
```

The existing client assertions are retained; their three fixed test identifiers are now local to the client test rather than importing the unrelated server-session fixture. No assertion was weakened. The normal workspace test inventory discovers both new `.test.mjs` files.

## Next implementation gates

Continue the order in DELIVERY_PLAN.md:

1. Complete dependency resolution with a genuine reviewed lockfile, semantic checks, lint and production/container builds on the authorized network-enabled development environment.
2. Run all real database and cryptographic suites in the documented disposable environment, including invitation single-use/expiry/revocation/concurrency and cross-organization access tests.
3. Exercise the real browser journey: invitation -> verified acceptance -> organization selection -> project role assignment -> requirements/design/build/test/readiness. Add lost acknowledgement, account change and browser restoration to that journey.
4. Only after those boundaries are accepted, enable approved-source AI requirement review and assessment explanation as reviewable drafts. This increment does not implement or enable AI.

No customer deployment or feature enablement is authorized or performed by these commands.

References for browser lifecycle limitations:
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- https://web.dev/articles/bfcache
