# GitHub run evidence — read-only, opt-in increment

Navyix can now inspect an existing GitHub Actions run attempt against a recorded build in the Design / Build / Test / Readiness workflow. This is **run/job metadata inspection**, not test-report ingestion, artifact verification or release enforcement. No workflow is started or retried. No customer source, logs or artifact bytes are downloaded. No AI provider is involved.

## Keep disabled until acceptance

The backend, browser sessions and PostgreSQL tenant boundary still require their outstanding real dependency/build/database/identity gates. This increment does not bypass those gates. Do not enable it for customers merely because its isolated tests pass.

```env
NAVYIX_API_ENABLED=false
NAVYIX_BROWSER_ENABLED=false
NAVYIX_GITHUB_ENABLED=false
```

When an isolated development environment has passed those gates, GITHUB is enabled on API and web, alongside the authenticated API/browser switches. Connection configuration and credentials belong **only in the API's private environment**, never NEXT_PUBLIC variables, source control, browser storage or a UI form.

## Connection configuration

`NAVYIX_GITHUB_CONNECTIONS` is a JSON array of operator-reviewed bindings. The following uses fictional IDs; replace every value with the customer's approved organization, project, repository and workflow identifiers. One binding is supported per project, at most 50 per process.

```json
[{
  "orgId": "11111111-1111-4111-8111-111111111111",
  "projectId": "22222222-2222-4222-8222-222222222222",
  "repository": "example/customer-portal",
  "repositoryId": 12345,
  "workflowIds": [67890],
  "requiredJobs": ["Application build", "Integration tests"],
  "events": ["workflow_dispatch"],
  "tokenEnv": "NAVYIX_GITHUB_TOKEN_PILOT"
}]
```

Store the credential separately under the exact `tokenEnv` name in the deployment secret manager. Prefer a short-lived GitHub App installation token restricted to approved repositories and **Actions: read**. The code only makes GET requests even if a supplied token has broader permissions. App installation, token issuance/rotation, customer consent administration and an integration-settings UI are NOT implemented here. Existing operator secret rotation/restart procedures are required. Disconnect by disabling the feature or removing its binding and restarting; no automatic failover to another repository/token/provider occurs.

Only push, workflow_dispatch and same-repository pull_request observations can be explicitly allowed. Fork/head-repository mismatches, other workflow IDs, repository renames/ID changes, wrong run attempts, and commit mismatches fail closed. Repository renames require a reviewed configuration update. The local build's entire 40/64-character commit SHA must equal GitHub's reported head SHA. For pull_request merge commits, record the correct tested SHA; no approximate branch-name match is used.

## User journey

Sign in, follow **Inspect GitHub run evidence** from the workspace (or open `/workspace/evidence`), connect an organization, choose an accessible project and recorded build, enter an existing numeric run ID and explicit attempt, and select Inspect. The panel shows required jobs and their reported outcomes plus a source link. An optional JSON export is an unsigned, editable observation, not portable trusted evidence.

The endpoint is:

`GET /v1/orgs/:org/projects/:project/github-evidence?buildId=BLD-001&runId=123&attempt=1`

Browser requests pass through the existing HttpOnly-cookie session proxy. API credentials never enter browser storage. Only GET is accepted for the new route; caller-supplied URLs, repository names, workflow IDs or tokens are rejected. Existing database-loaded organization/project membership is checked before external work AND again before returning the observation. A project revision change during collection yields a conflict. Failed reads clear the displayed observation, and changing the selected context or signing out discards late responses.

## Evidence semantics

Each result records organization, project revision, local build context, GitHub repository ID/name, workflow ID, run ID, attempt, exact commit SHA, event, provider status/conclusion, normalized jobs, collection time and a SHA-256 checksum of normalized content. The checksum is **not** a signature or attestation.

Missing/ambiguous required job names, empty job sets, missing timestamps, skipped jobs, cancelled jobs and failures never become reported success. Job pages are read to completion, with duplicates, changing totals and truncation rejected. The selected attempt is re-read afterward to detect changed run metadata. This is a bounded point-in-time observation, not a transaction across GitHub APIs or a claim that the selected attempt is the latest attempt.

A run's metadata does not bind an OCI image or deployed artifact, establish requirement coverage, or establish that a test suite exercised the relevant behavior. The returned `artifactVerified` and `testCoverageVerified` are always false, and `readinessEffect` is always `none`. The existing readiness engine, saved assessments, test reports and project state are untouched. No provider metadata is promoted to a passed test case or verified build record.

## Safety and operations

- Fixed `https://api.github.com` origin, approved repository path, explicit attempt-specific endpoints, GET only, redirects rejected. Provider URL fields and Link headers are never followed.
- Maximum 500 jobs, 5 pages, 1 MB per response, 4 MB total raw response content and a 10-second external deadline. A larger run fails rather than silently omitting jobs.
- One active inspection per configured project, four per process, a 10-second minimum per-project interval, and provider rate-limit backoff shared by secret reference. No automatic retries or polling. These are **process-local pilot guards**, not distributed quotas; replicas need shared limits before scale-out.
- Upstream errors are redacted. Secret values, raw response bodies, logs, actors/emails and source code are not returned. The feature does not alter GitHub repositories, grants or workflow settings.
- This increment does not persist observations or audit inspection requests. Durable ingestion, scheduled reconciliation, GitHub App lifecycle, artifact/test report association and provenance-aware release criteria remain follow-on work.
- No new dependencies, migrations or GitHub Actions triggers. Existing mandatory acceptance gates remain in place.

## Verification

```sh
node --test packages/server/test/github*.test.mjs packages/browser-session/test/evidence*.test.mjs
python tests/github_evidence_browser.py --offline --browser /path/to/chromium --artifacts /tmp/navyix-evidence-checks
```

The Python test injects synthetic API responses and embeds the exact component/CSS in an offline document. It does not test a deployed origin, real login, GitHub connectivity, framework build or PostgreSQL. Full validation must include the real API in a disposable two-organization environment, repository permission removal, key expiration, real multi-attempt runs, approved same-repository PR behavior, browser accessibility and the full application regression/build checks. Do not start a CI workflow solely to populate this screen without the user's explicit request.

## Official API references checked 12 November 2026

- Get an exact run attempt / Actions read permissions: https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt
- Attempt-specific job pagination: https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt
- Rate-limit responses/backoff: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

References establish the API contract; they do not certify this implementation.
