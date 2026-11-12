# Invitation onboarding validation — 12 November 2026

Reviewed base: main at `097f7ca477ca56f6d7c8a2f943adf9fc68453bf4`.

## Implemented source

Opt-in invitation creation/list/revocation, verified-recipient preview/acceptance, separate private SQL schema/function, existing-session proxy integration, and a responsive `/workspace/invitations` screen. No actual invitation, identity-provider account, email, customer migration, feature activation or deployment was performed. Role ceilings and current-access checks are implemented in code/SQL; the SQL remains unexecuted.

The existing project/readiness rules are unchanged. This increment creates no project membership and does not make an engineering readiness or release decision.

## Execution environment and checks

Linux working container with Node v22.16.0, TypeScript transpiler, Python Playwright and Chromium. Package-registry DNS resolution remains unavailable. No pnpm, PostgreSQL server or Docker daemon is present. The authorized desktop device was offline. Current originals were reconstructed from reviewed source and prior packages only after matching their current Git blob hashes. This is a sparse source workspace, not a complete application checkout.

Final focused command:

```sh
node --test packages/server/test/invitation*.test.mjs packages/browser-session/test/invitation*.test.mjs packages/browser-session/test/session.test.mjs packages/browser-session/test/http.test.mjs
```

**107 tests: 106 passed, 0 failed, 1 skipped, 0 cancelled, 0 TODO.** This is one combined run, not the sum of repeated runs.

Checks include real Node HMAC/SHA-256 generation, canonical token handling, input/role limits, proof matching, fixed HTTPS UserInfo routing, malformed/oversized responses, cancellation/deadline behavior, process-local concurrency, database query/role contracts, actual loopback HTTP routing with test identity/storage, the real session proxy with test provider/storage, safe browser retry and stale-response handling. Existing session and HTTP regressions are included. The UserInfo response is simulated, and session signature verification/storage use test substitutes. No provider signature or real database claim follows from these tests.

The PostgreSQL lifecycle group was skipped. Its **12 nested scenarios** cover administrator boundaries, redacted lists, wrong recipients, initial acceptance and identical retry, consumed/revoked/expired codes, disabled memberships, identity collision, parallel acceptance, organization suspension, inviter demotion and restricted runtime privileges. They are prepared but NOT executed. Strict invocation exits 1 when disposable database prerequisites are absent; that is a blocked gate, not a pass. The migration has not been parsed/validated by PostgreSQL or Prisma.

Browser command:

```sh
python tests/invitations_browser.py --artifacts /mnt/data/navyix-invitation-results
```

**20 offline Chromium checks passed; 0 uncaught page errors.** Actual component, invitation client, current BrowserWorkspace adapter and styles with synthetic session/API records. Checks include creating an invitation, simulated lost acknowledgement and identical retry, one displayed result, hidden code, confirmation/cancellation/revocation, explicit preview/acceptance, URL secret exclusion, denied-refresh clearing, cross-tab sign-out, and no page-level horizontal overflow at 360/390/768/1440 pixels. Screenshots were visually inspected and are labeled synthetic. The harness's response fixture is not the real database state machine, and acceptance in this harness is not evidence of live single-use consumption.

All changed/new JavaScript syntax checks passed. API startup and both Next pages had no TypeScript/TSX transpilation syntax diagnostics. This is not semantic TypeScript checking or a framework build. Existing dependency manifests and CI definitions are unchanged. The disposable lab source was matched to current blob `eb66b9afad8a8e5dc16469f7dc1d1ab40325b6d1` before adding the new live suite; its full orchestration tests were not rerun here.

## Corrections during development

A binding test initially used the literal subject `subject`, which also occurs in the fixed GUC name `navyix.subject`; it was replaced with a hostile-looking subject to verify actual parameter separation. A proxy fixture initially omitted the required idempotency header and correctly received 400; the valid-request fixture was corrected. No permission assertion was weakened. The interface now clears an issued code on organization change or access denial and retains editable creation fields after validation failures.

The SQL function uses explicit variable names to avoid column/parameter ambiguity and places the temporary schema last in its fixed search path. These were source-review corrections, not results from executed SQL.

## Not executed / acceptance remaining

No genuine dependency lockfile, dependency/security audit, complete current policy/workflow/backend regression, semantic typecheck, ESLint, Prisma validate/generate/migrate, Next/Nest/container build, actual SQL/RLS/concurrency integration, real IdP/UserInfo/cryptographic verification, real-origin rendered browser journey, clipboard permission test, Firefox/WebKit/OS matrix, screen-reader audit, load, distributed-quota or recovery acceptance was completed.

No readiness flag, source grant, customer credential or actual email recipient was configured. The source is disabled-by-default work toward onboarding, not a live service. The next gate remains the complete application build and real two-organization identity/database/browser acceptance, including these invitation tests.
