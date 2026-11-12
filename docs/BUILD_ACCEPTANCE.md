# Build and regression acceptance

This increment hardens the checks around the existing Design / Build / Test / Readiness application. It adds no product feature, changes no readiness decision rule, enables no runtime flag, and is not a production acceptance result.

## Requirements and commands

Use Node.js **22.16.0 or newer**, matching the repository engine requirement. The explicit runner needs per-file `test:summary` events; it does not rely on a shell expanding wildcards.

```sh
# List selected tests without executing them.
node scripts/test-workspace.mjs --list
# All five groups: policy, workflow, server, browser-session, and tooling.
node scripts/test-workspace.mjs
# Scoped development runs. Multiple groups may be selected explicitly.
node scripts/test-workspace.mjs --group workflow
node scripts/test-workspace.mjs --group server --group browser
node scripts/test-workspace.mjs --group tooling
```

`pnpm test`, `pnpm test:workflow`, `pnpm test:server`, and `pnpm test:tooling` use the same runner. Existing focused browser and journal scripts remain available. Results from a focused group do not establish a full-workspace pass.

Every selected group must contain test files. Symlinks in test trees are rejected. When `.git` is present, the runner compares discovered files with `git ls-files` and blocks missing tracked tests, including sparse-checkout omissions. New untracked tests are included. An archive without `.git` is labeled `filesystem-only`: completeness against tracked Git contents cannot be established in that mode.

Files must emit genuine per-file Node test summaries with at least one declared test. Bare Node can treat an empty module as one successful file-level test; that is deliberately rejected here. A missing final summary, failures, cancellation, or TODO tests fail the gate. Normal-mode skips are counted and yield **passed-with-skips**, not a fully verified integration result. Exit codes: 0 for a completed normal run (possibly with explicitly reported skips), 1 for test failure, 2 for blocked prerequisites/options.

## Database execution is explicit

The ordinary runner removes inherited `NAVYIX_TEST_*` and `NAVYIX_REQUIRE_*` values from its test subprocess environment. Consequently the repository's live database suites do not run merely because test URLs happen to be exported. Cryptographic tests may still run locally when their declared libraries are installed.

Strict integration is a separate explicit action:

```sh
node scripts/test-workspace.mjs --integration
# Or include semantic typechecks, lint, Prisma generation and application builds:
node scripts/verify-workspace.mjs --integration
```

Both require `NAVYIX_TEST_DB_CONFIRM=disposable` plus the runtime, administrative, and browser test URLs described in the existing server/session setup guides. Use only an already migrated disposable database. Strict mode sets both server/session integration switches and rejects **all** skips. These commands do not create or migrate a database. The existing `integration-lab.mjs --run --full` remains the explicit Docker-based option described in `ACCEPTANCE_LAB.md`.

## Build configuration corrections

The API ESLint configuration now declares and uses `@typescript-eslint/parser`, so TypeScript annotations and decorators have the appropriate parser. It includes explicit rules for debugger/eval use, constant conditions, duplicate switch cases, constructor-super correctness and equality comparisons. TypeScript semantic checks remain a separate `tsc --noEmit` gate. This is a baseline lint policy, not a complete security audit.

The web lint configuration excludes generated `.next`, build/coverage output and copied `public/workbench` assets. The canonical `apps/web/workbench` sources remain included; this does not exempt them from linting.

`verify-workspace.mjs` now calls the existing `db:validate` wrapper, rather than invoking Prisma directly without the root `.env` loading behavior. It checks for the parser dependency and required test groups. Its strict regression step uses the entire test inventory, including the newer acceptance/team/journal suites and tooling, instead of only the original two integration entry points. It does not run the ordinary and strict test inventories twice.

## Network-enabled acceptance

The added parser dependency must be resolved into a **real** lockfile. No lockfile has been fabricated or generated in the restricted environment.

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
# First resolution only; review dependency changes and the generated lockfile.
pnpm install --no-frozen-lockfile
pnpm test
# With the documented local environment configured:
node scripts/verify-workspace.mjs --full
```

After reviewing/committing the actual lockfile, use frozen installs. No dependency security or compatibility clearance is implied by the declared version ranges. The live lint fixture in `scripts/test/build-config.test.mjs` must execute with the real installed ESLint/parser, not a substituted parser. Full Next/Nest/container builds and browser/provider/database acceptance remain required.

No GitHub Actions definition or trigger was changed. Work remains on `main`; no workflow, deployment, or customer migration is performed by these checks.

## References

- Node.js test runner: https://nodejs.org/docs/latest-v22.x/api/test.html
- TypeScript parser configuration: https://typescript-eslint.io/packages/parser/
- ESLint parser configuration: https://eslint.org/docs/latest/use/configure/parser

These document tool behavior, not a certification of the application.
