# Saved GitHub observations — opt-in development increment

Navyix's existing Design / Build / Test / Readiness workflow now has an implementation for durable, project-scoped GitHub observation history. This is not a production acceptance claim. No live migration, provider collection, database integration, or framework build was executed in this increment.

## Product flow

Open `/workspace/evidence/history` from the workspace. Sign in, select an authorized organization/project and existing recorded build, enter an existing run and explicit attempt, review the named target, then choose **Collect and save**. The server fetches fresh metadata through the existing approved GitHub collector; no browser-uploaded observation is accepted. Source calls remain GET-only. No workflow is started, rerun, edited or scheduled.

Saved records retain project revision, build/commit/digest/environment context, source run/attempt, collection time, normalized jobs, collector checksum and a canonical persistence checksum. The newest-first list can be paged; a detail view labels a record historical when the current project revision differs. Earlier records are never rewritten by project edits. Refresh and detail reads do not contact GitHub. Export is an unsigned editable JSON copy, not portable proof.

**Observation is not approval.** `artifactVerified=false`, `testCoverageVerified=false`, and `readinessEffect=none` remain mandatory. No test is marked passed, no assessment is approved, and no `WorkflowState` or `WorkflowSnapshot` is changed by capture. Database persistence does not establish artifact identity or test-case coverage. The stored collector limitation text describes the original observation; the containing journal entry supplies the durable record metadata.

## Configuration and rollout

Keep the following false until the complete dependency/build, actual PostgreSQL/JOSE and rendered two-organization browser acceptance gates pass:

```env
NAVYIX_API_ENABLED=false
NAVYIX_BROWSER_ENABLED=false
NAVYIX_JOURNAL_ENABLED=false
NAVYIX_GITHUB_ENABLED=false
```

For isolated development only, apply the reviewed `202611120004_evidence_journal` migration after the earlier migrations, regenerate/validate Prisma and run strict integration. Set JOURNAL on API and web. Capturing new observations also needs the existing approved GitHub connection and GITHUB flag. Disabling collection does not disable authorized history reads or committed-request replay. Startup rejects missing RLS/grants and owner/superuser/BYPASSRLS credentials. No dependencies, automatic migrations, CI events or deployments were added.

## API

All paths use the existing verified access token and current database memberships; browser callers use the same-origin HttpOnly session proxy.

- `GET /v1/orgs/:org/projects/:project/github-observations?limit=20&after=UUID`: newest-first, bounded history. Cursor is an existing observation in the same project. Maximum page size 20.
- `GET /v1/orgs/:org/projects/:project/github-observations/:id`: current-access check, canonical integrity check and original record, plus current project revision.
- `POST /v1/orgs/:org/projects/:project/github-observations`: explicit fresh capture, with `Idempotency-Key: UUID` and the following exact body:

```json
{"expectedRevision":2,"buildId":"BLD-001","runId":"123","attempt":"1"}
```

No token, repository, URL, actor, observation document or authority assertion is accepted in this body. Capture input is bounded at 4 KB. Acknowledgements identify the observation, organization/project, revision, request ID and persistence checksum.

Both organization AND project roles must permit capture (OWNER, ADMIN or CONTRIBUTOR). Active REVIEWER and VIEWER members may read; no organizational role overrides absent project membership. Membership and suspension are checked before collection and again before persistence or replay. Reads always reauthorize. Revocation blocks later authorized requests, not requests already completed.

## Transactions and reliability

No database transaction remains open during GitHub network I/O. After collection the service rechecks authorization, locks the project aggregate, checks its expected revision and the 100-record pilot cap, validates collector target/checksum/size/time, then inserts the observation, audit event and idempotency receipt in one serializable transaction. Failure leaves no partial record. Concurrent conflicts return 409 rather than silently overwrite.

A retry after a committed capture reauthorizes and returns the original receipt without contacting GitHub again. A request ID reused for different parameters is rejected. An uncertain browser response retains the exact body and key; new captures and context changes are blocked until resolved. A confirmed capture followed by a failed reload is labeled saved: refresh history, do not submit again. This is idempotent logical persistence, not a claim of exactly-once external execution; a failure before commit may require fresh GET collection on retry.

The `GitHubObservation` table is forced-RLS, has tenant-aware foreign keys, only SELECT/INSERT runtime grants, and no SECURITY DEFINER entry point. Application, session and migration roles stay separate. Audit entries record successful captures; failed attempts and history reads are not durably audited by this increment. The shared runtime identity is not protection against arbitrary application-server compromise; API identity verification remains essential.

Canonical SHA-256 uses recursively sorted object keys to survive JSONB key reordering. It detects changed observation content on read, but is not a signature, externally anchored log or protection against an administrator who can rewrite both content and checksum. The original collector checksum is retained alongside it.

The pilot cap is 100 observations per project with a 500 KB collector-output cap. No silent eviction or runtime deletion is implemented. Tenant deletion, retention automation, durable jobs/outbox, fleet-wide quotas, GitHub App lifecycle and artifact/report provenance are still future work. Existing collector rate/concurrency guards are process-local. Do not scale this feature as a production ingestion pipeline without those controls.

## Verification

```sh
node scripts/test-journal.mjs
# Requires declared dependencies and a migrated disposable database:
node scripts/test-journal.mjs --integration
# Existing explicit disposable Docker lab now includes journal-live.test.mjs:
node scripts/integration-lab.mjs --run --full --report ../navyix-acceptance-result.json
```

The test runner checks that the expected test files exist. Strict mode fails when the disposable database is missing; it does not turn a skipped integration into a pass. `tests/journal_browser.py` is explicitly an offline exact-component harness with synthetic session/API responses and embedded CSS, not real-origin Next/OIDC/database acceptance. See `EVIDENCE_JOURNAL_VALIDATION_2026-11-12.md`.

Rollback: disable JOURNAL on API and web, keeping history/audit data intact. Do not drop records or weaken access policies to roll back the interface.

## Design references

- PostgreSQL row-security behavior and limits: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- GitHub attempt-specific metadata endpoints: https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt

These references support platform behavior; they do not certify the unexecuted database migration.
