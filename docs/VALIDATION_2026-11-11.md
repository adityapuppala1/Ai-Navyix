# Validation record — local workflow increment, 11 November 2026

## Executed

- Node.js 22.16.0: **65 tests passed** in `packages/workflow/test/*.test.mjs` (51 domain, 8 storage, 6 preview HTTP tests).
- Chromium via Python Playwright: **25 workflow checks passed** in the offline DOM/component harness. The source was loaded from the actual workbench/domain modules; the harness used embedded CSS and an in-memory Storage adapter.
- Browser journey: empty project -> requirement/review -> design/review -> exact build -> test definition -> failed report -> blocked readiness -> passing retest -> saved assessment -> exported JSON payload -> requirement revision -> invalidated current readiness with unchanged history.
- Responsive checks: all seven project views at 360, 390, 768 and 1440 px with no page-level horizontal overflow.
- Checked modal Escape behavior, reduced-motion CSS, light/dark switching, HTML escaping, project switching, component re-open, report file parsing and zero uncaught browser JavaScript errors in that journey.
- Preview HTTP checks: HTML/CSP, JavaScript MIME/module serving, private-path rejection, POST rejection, Host rejection and HEAD handling.
- Module syntax checks and generated-asset copying completed.

## Not verified / not implemented

- npm registry hostname could not be resolved in the execution environment. No dependency install, resolved lockfile, full Next.js/NestJS compilation, dependency audit or Docker image build was completed.
- Browser navigation to the local preview was blocked by the environment's browser policy. No policy was changed. Browser interactions were tested in the explicitly offline harness, not via the HTTP or Next.js page.
- Browser-origin localStorage persistence, actual browser download permissions, Firefox/WebKit, mobile OS/device behavior, screen-reader audits and full WCAG conformance remain unverified. The export check captured the generated JSON payload rather than claiming a verified browser download.
- Existing policy-package tests are retained, but not included in the counts above; the root test command includes both suites for the next complete run.
- No production OIDC, tenant isolation, database persistence, GitHub ingestion, hosted AI, deployment enforcement or load/recovery certification is claimed.

## Repository operations

Only the existing `main` branch is targeted. The manual-only workflow file is not changed, no workflow is dispatched and no infrastructure is deployed. This is a functional local vertical slice, not the completed customer SaaS.
