# Organization selection integration — 12 November 2026

Reviewed base: `main` at `b42db2c8af9f4ae06fc6e29fbd2dd42bdb86850e`.

## Scope

Integrate the previously delivered organization-selection package into the existing connected Design / Build / Test / Readiness workspace. Eight modified originals were matched byte-for-byte to their current Git blob identities before applying the prepared edits. All thirteen packaged source files were checked against their recorded SHA-256 hashes. Existing source was preserved; this increment does not supersede the rest of the application.

The API is identity-derived and read-only. The named picker uses the existing session proxy, organization/project access checks and project-loading path. The additive directory migration adds only own-membership SELECT policies. It has not been executed here. Backend/browser/directory features remain disabled unless explicitly configured. No invitation, signup, email delivery, role grant, AI call or readiness override is introduced.

Improvements beyond the pending package: directory names are cleared when session state is lost; parent acceptance of a choice is explicit so controls cannot remain stuck when a parent ignores it; selection is checked against the active directory; the connected screen displays the selected organization name. Added proxy and connected-shell regression coverage.

## Executed

Environment: Linux container, Node v22.16.0, Python Playwright with Chromium. The npm registry DNS probe failed. No pnpm, Docker daemon, PostgreSQL or installed application framework dependencies were available. This is a verified sparse source workspace, not a complete checkout.

```sh
node --test packages/server/test/directory*.test.mjs packages/browser-session/test/organization*.test.mjs packages/browser-session/test/session.test.mjs packages/browser-session/test/http.test.mjs
```

Result: **163 tests: 162 passed, 0 failed, 1 skipped, 0 cancelled, 0 TODO**.

- Existing packaged directory tests were rerun, not assumed to pass from earlier logs.
- Two additional client regressions check erasure of already-loaded organization names after sign-out/context change.
- Sixteen new proxy tests use the actual current browser handler and bounded body reader, test session storage and synthetic upstream responses. They cover fixed GET routing, token containment, missing/deleted/expired sessions, unexpected identity/role parameters, write rejection, redaction and cookie non-forwarding.
- Existing session and loopback HTTP regressions are included. These do not verify a real identity provider or database.
- One live PostgreSQL group is skipped. Its nine nested scenarios have not executed; query-text and policy-contract tests are not evidence of SQL isolation.

Browser commands:

```sh
python tests/organization_directory_browser.py --offline
python tests/organization_workspace_browser.py
```

- **16 standalone component checks passed**, including keyboard choice, pagination, no horizontal overflow at 360/390/768/1440 px, unsafe-looking labels, denied refresh and stale responses. Screenshots use synthetic memberships.
- **16 connected-shell checks passed**, using the actual connected component, picker and BrowserWorkspace adapter. The unchanged local-workbench superclass is a presentation stub and the API is synthetic. Tests cover session-to-directory integration, selected project/four-stage readiness loading, switching contexts, displayed names, revoked access, pending-write protection, sign-out during loading, feature-off compatibility and unhandled-choice recovery.
- Both browser runs reported zero uncaught JavaScript exceptions. These are offline tests, not full application, real-origin cookie, provider or database validation.

An initial connected-shell harness concatenated two module-scoped helper names into one classic-script scope. Wrapping the modules separately corrected that harness setup; no product assertion was weakened. The corrected run is the reported result.

Changed/new JavaScript syntax checks and TypeScript/TSX transpilation syntax checks passed. They are not semantic TypeScript checks or framework builds. Strict database invocation without disposable settings exits nonzero as required; it is a blocked gate, not success.

## Still unverified

No genuine lockfile, dependency audit, full current policy/workflow/server regression from a complete checkout, semantic typecheck, ESLint, Prisma validation/generation, Next/Nest/container build, migration, live SQL/RLS/cryptographic acceptance, hosted-provider login, real browser-origin session behavior, live GitHub call, screen-reader/Firefox/WebKit/OS matrix, load or recovery test was completed. The two browser harnesses do not prove the whole application works.

No automatic CI trigger, workflow dispatch, customer migration, cloud resource or deployment is part of this increment. Existing workflow definitions and dependency manifests are unchanged.

## Next acceptance and onboarding work

First resolve the existing full-build/real-database/real-browser gates in DELIVERY_PLAN.md. Then implement invitation creation, revocation and single-use acceptance with verified recipient identity, permitted role assignment, expiry, token-safe storage and audit/transaction tests. This commit does not claim invitations are implemented and does not enable email delivery. The organization picker is the entry point for members once provisioned.
