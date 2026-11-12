# Build/test hardening validation — 12 November 2026

Reviewed repository base: `8b06e55d16acad25b8dd50a4aa239a5b82b1c291` on `main`.

## Scope

Replace shell-glob root test commands with explicit cross-platform discovery of all five groups, including tooling tests. Reject missing groups/tracked tests, empty test files, missing summaries, cancellation and TODO results. Normal-mode skips remain visible; strict integration rejects them. Database tests require explicit disposable settings. Fix API TypeScript parser configuration, generated-web-asset lint exclusions, and environment-consistent Prisma validation. No application domain rule, UI, tenant policy, session behavior or evidence semantics was changed.

## Executed

Environment: Linux container, Node.js 22.16.0. npm registry and public Git host DNS resolution failed. Application dependencies, pnpm, Docker and PostgreSQL are not available. Sources were inspected through the GitHub connector at the reviewed commit. This is a sparse working copy, not a full checkout.

1. `node --test scripts/test/test-workspace.test.mjs scripts/test/build-config.test.mjs packages/browser-session/test/verification.test.mjs`: **66 tests; 65 passed; 0 failed; 1 skipped**.
   - 47 runner/discovery/environment/accounting tests. Seven launch real fresh Node processes to prove actual assertion execution, no-op-file rejection, assertion/import failure, skip accounting, strict skip rejection, and TODO rejection.
   - 13 verification-plan/configuration tests. Build commands are intercepted, not executed. The disposable-URL checks, all-suite strict plan, schema-wrapper selection and error-stop behavior are tested.
   - Five build/lint configuration-contract tests pass. The sixth test, actual ESLint TypeScript/decorator parsing, is **skipped** because the declared ESLint/parser packages are absent. This skip is not counted as lint validation.
2. The same three files were run through `node scripts/test-workspace.mjs --group tooling --group browser`: result **passed-with-skips**, with the same 66/65/1 counts. This is a second execution of the same cases, not 130 distinct passing tests. The report explicitly says `filesystem-only`.
3. Default all-group invocation against this sparse copy exited **2** before running tests because `packages/policy/test` is missing. It did not return a green zero-test run.
4. `--group tooling --integration` with no disposable settings exited **2** before execution. This is a blocked gate, not passed integration.
5. `verify-workspace.mjs --full` exited **2** and recorded missing dependencies, lockfile and complete test inventory. No build, install or migration process was launched.
6. Node syntax checks for changed/new `.mjs` files passed. The original root/API manifests and both lint configurations were reconstructed and matched to their GitHub blob hashes before modification.

## Not executed

No package install/audit or lockfile generation, actual ESLint invocation, semantic TypeScript check, Prisma validate/generate, Next/Nest/container build, SQL migration, real database isolation/concurrency suite, live provider sign-in, full application browser test, or full-repository regression run. Existing policy/workflow/server/domain suites are unchanged and were not re-executed from this sparse copy. The new runner intentionally refuses to present that incomplete inventory as full-workspace validation. No new screen or screenshot is claimed.

Cross-platform arguments/discovery are implemented without shell wildcard expansion; real Windows/macOS execution is still unverified. The new symlink negative test uses a directory junction so it does not depend on Windows file-symlink privileges.

All runtime feature flags and the manual-only CI workflow remain unchanged. No customer data, database, deployment, branch or GitHub workflow was changed by testing. Actual acceptance remains blocked until the full checkout and declared dependencies are available on a network-enabled development environment.
