# Server workflow validation — 11 November 2026

Base: main at a5f0635cc4bb8e59099bf82dfab7cf6ce47b3fb9.

## Executed in this increment

Environment: Linux container; Node.js v22.16.0. Registry/Git DNS access unavailable.
No PostgreSQL server, Docker daemon or installed Nest/Prisma/JOSE packages were available.

- `node --test packages/server/test/*.test.mjs`: **114 tests total; 112 passed; 0 failed; 2 skipped**.
- 44 service tests execute the existing workflow domain against a transactional in-memory TEST DOUBLE.
  They cover the complete requirement/design/build/test/readiness loop, failed/passing executions,
  snapshot persistence semantics, revision invalidation, permissions, revocation, retries and rollback.
- 38 authentication configuration/claim-policy tests. JOSE verification is injected/stubbed here;
  these are NOT cryptographic signature tests.
- 14 HTTP tests send requests to an actual loopback Node HTTP server using the real shared handler,
  service and test identity/storage adapters. Includes unauthorized/cross-tenant requests, malformed JSON,
  oversized bodies, methods, duplicate authorization, caching headers and error redaction.
- 16 repository-contract and migration-text checks. These inspect fixed SQL, parameter binding,
  transaction context, privilege guards, row-security declarations and relational constraints.
  They are NOT execution of SQL against PostgreSQL.
- `node --check` on all newly added .mjs files: passed.
- TypeScript transpileModule syntax diagnostics for main.ts and app.module.ts: no errors.
  This is NOT semantic typechecking or a Nest application build.
- Shared workflow.mjs was read from GitHub and verified byte-for-byte with its existing blob SHA
  c70e13312f530ed33a3bf47ee3feb02178cee427. It is unchanged in this increment.
- Strict integration invocation with NAVYIX_REQUIRE_INTEGRATION=1: exited 1 as intended when JOSE
  and a disposable PostgreSQL database were unavailable. This gate did NOT pass.

## Explicitly skipped or not executed

1. Real JOSE signature integration: skipped because the dependency could not be installed.
2. Real PostgreSQL runtime-role/RLS/pool integration: skipped because no disposable database was available.
3. pnpm install, dependency audit/lockfile, Prisma generation/validation/migration, full TypeScript
   typecheck, ESLint, Next/Nest production builds and container builds: not completed.
4. Real IdP/JWKS connectivity, browser OIDC login and authenticated UI persistence: not completed.
5. Existing full policy/workflow/browser suites were not re-executed; their source was not changed.
6. No external workflow was dispatched, no database was changed and no deployment was performed.

## Required acceptance gates

Use docs/SERVER_WORKFLOW.md for network-enabled setup. Review the actual generated dependency lockfile,
pass semantic build/type/lint checks, migrate a disposable database with restricted runtime credentials,
then execute the strict integration mode. Confirm membership/suspension boundaries with real tokens
and database sessions before enabling customer access. The browser continues as the existing local preview.

These results establish progress on implementation, not production readiness or complete tenant isolation.
