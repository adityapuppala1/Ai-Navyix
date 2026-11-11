# Test strategy
## Currently verified
12 built-in Node tests for pure readiness evaluator: ready, blocked, unknown, stale, advisory, valid and expired exceptions, wrong artifact, precedence, duplicate IDs and fail-closed inputs.
## Required before customer pilot
Unit: policy, evidence freshness/version and access matrix. PostgreSQL integration: RLS with real runtime credentials, pooled reuse, FK isolation, transactions and migrations. Contract: GitHub webhooks/events, CI report formats, structured AI outputs. Playwright: accessible onboarding, org switching, project workflow, blockers, approvals, AI grants. Security: IDOR/XSS/CSRF/SSRF, files/embeddings/export leakage, webhook replay, prompt injection and secret scanning. Reliability: queue duplicate/out-of-order and worker crash, AI outage, backups, restore and deleted-grant replay. k6: representative 150 active user test, 50 normal RPS and 500 webhook/min burst proposed (not measured). OS/browser and mobile/reduced-motion regression.
## Evidence records
Test ID, requirement revision, artifact digest, environment/config, expected/observed result, skipped/failed/blocked/pass, timestamp, owner, source URL and raw logs. A generated test is NOT an executed test.
## CI
Manual GitHub workflow only. No push, PR, schedule or deploy automation until explicit user approval.
