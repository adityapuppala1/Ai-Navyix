# Design, Build, Test & Readiness — first working vertical slice

## Run without installing packages

From the repository root with Node.js 22 or newer:

```sh
node scripts/preview-workflow.mjs
```

Open the printed address, normally `http://127.0.0.1:4173`. Stop with Ctrl+C. The server binds only to loopback, serves an explicit static-file allowlist, rejects foreign Host headers and accepts GET/HEAD only. It does not execute customer code or expose APIs.

Once project dependencies are available, `pnpm --filter @navyix/web dev` copies the same component/domain sources into `public/workbench` and exposes the workbench at `/workspace`. This is the existing Next.js application, not a second SaaS architecture. The shared native component is an incremental delivery choice that keeps the product workflow executable despite the package-registry limitation.

## What works

Create a project with an owner, goal and environment. Add requirements with acceptance criteria; revise and locally review them. Record design decisions against exact requirement revisions and mark them reviewed. Record a build using a complete commit SHA, SHA-256 artifact digest, environment and observed build outcome. Define versioned test cases linked to requirements. Import JSON execution results by paste or file. Inspect live readiness for design, build, test and release. Open any criterion to inspect evidence, its owner and next action. Save immutable-in-the-application assessment snapshots and export project or assessment JSON.

Records persist in this browser's local storage. An optional sample project uses explicitly synthetic evidence. Light/dark themes, responsive layouts, keyboard-operable modal dialogs and reduced-motion handling are included. The existing homepage Three.js component is retained, not replaced or newly validated by this increment.

## Report contract

Download a template from Tests & results after recording a build and defining tests. The template contains the real local project UUID, build ID, exact digest, environment and current test revisions. Every template outcome starts as `skipped` rather than an invented pass.

```json
{
  "schemaVersion": 1,
  "projectId": "COPY_THE_PROJECT_UUID_FROM_THE_TEMPLATE",
  "runId": "ci-run-unique-identifier",
  "buildId": "BLD-001",
  "artifactDigest": "sha256:REPLACE_WITH_64_HEXADECIMAL_CHARACTERS",
  "environment": "staging",
  "executedAt": "2026-11-11T14:00:00Z",
  "sourceUrl": "https://example.com/your-run",
  "results": [
    { "testCaseId": "TST-001", "testCaseRevision": 1, "status": "passed", "note": "Observed outcome from the test runner" }
  ]
}
```

This example is explanatory, not importable until placeholders and timestamps are replaced. Allowed outcomes are `passed`, `failed`, `skipped` and `error`. Source URLs are optional, HTTPS-only and never fetched by the preview. The current integration is a Navyix JSON format, not a JUnit or GitHub importer.

Imports reject wrong projects, artifacts, environments and test revisions; duplicated runs/results; unknown test IDs; malformed or oversized input; future timestamps; executions before the selected build or test definition. Validation is atomic. Reports are capped at 1 MB / 200 results, with 100 retained runs per local project.

## Starter policy

- **Ready for design:** at least one requirement with acceptance criteria.
- **Ready to build:** current requirements and latest linked designs have local review records.
- **Ready to test:** the build succeeded for current requirements/designs and selected environment, and tests cover current requirement revisions. Existing product defects do not automatically prevent testing.
- **Ready for release:** the above plus an observed passing execution for every defined test, matching project/build/digest/environment/test revision, within seven days.

A failure or error blocks the decision. Missing, skipped or outdated evidence cannot make a decision Ready. Recent failed evidence remains blocking until superseded; historical runs remain visible. New requirement/design/test versions invalidate dependent evidence. Saved assessment snapshots retain captured records rather than dereferencing mutable current values.

The policy intentionally does not claim complete release governance: security scans, approvals, environment provisioning, operational readiness and exceptions must be added to the production policy model. The seven-day window is a starter value, not a universal recommendation.

## Security and persistence boundaries

**Local and advisory only.** Browser storage is user-editable; neither project separation nor local review buttons constitute RBAC, tenant isolation, authenticated approval or tamper-evident audit. Do not put real customer source code, secrets or sensitive documents here. No hosted model is connected and no content is sent to one.

Export before clearing browser data. The preview retains up to 20 projects, 200 records per primary collection, 100 runs/assessments per project, and 3 MB total serialized workspace data. Quota/corruption errors are surfaced instead of overwriting records. Concurrent tabs use Web Locks where available plus a revision check; on browsers without Web Locks, use one editing tab. The workflow can export project JSON but importing a whole workspace backup is not implemented yet.

The NestJS backend remains closed to business requests until OIDC verification, trusted server membership lookups, tenant-scoped PostgreSQL persistence/RLS and integration tests are ready. Do not deploy the local preview as the customer SaaS.

## Verification

```sh
node --test packages/workflow/test/*.test.mjs
# With Python Playwright and Chromium installed:
python tests/workflow_browser.py --url http://127.0.0.1:4173
```

The browser script also supports `--offline`: it embeds the exact local component/domain code and CSS into an offline page and supplies an in-memory Storage adapter. That mode tests UI interactions, not real browser-origin localStorage, module serving, Next.js or authentication. It does not bypass browser navigation policies. `--browser` can select an installed Chromium executable; `--artifacts` controls screenshots/results output.

See `VALIDATION_2026-11-11.md` for the checks actually executed in this increment.

## Next delivery gates

1. Resolve and review dependencies; commit a real lockfile; run full Next/Nest builds, lint and typechecks.
2. Run the browser suite against the actual HTTP/Next route, including real storage reload and download handling; add Firefox/WebKit and accessibility audits.
3. Replace browser persistence with authenticated tenant/project services and reviewed migrations. Enforce permissions and test cross-tenant reads/writes, files, jobs, search and exports before onboarding customers.
4. Import independently identified GitHub/build/test evidence and persist assessments with server-controlled provenance and audit history.
5. Add approved-source AI assistance behind grant, permission, budget and evaluation controls. Never let AI directly decide readiness.
6. Complete operational criteria, monitoring, recovery/load/security testing and a controlled multi-customer pilot.
