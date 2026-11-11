# Security baseline
1. Default deny: initial API exposes health only. Implement OIDC issuer/audience/JWKS validation and server-side action RBAC before exposing tenant data. MFA for admins.
2. Tenant separation in SQL/RLS and every non-SQL path: objects, AI chunks, signed URLs, exports, caches, job workers, SSE. Do not trust organization IDs supplied by clients.
3. Managed secrets, restricted DB role, transaction-local RLS context, no owner/BYPASSRLS runtime, tenant-scoped FK/indices and negative DB pool tests.
4. Verify webhook HMAC and installation ID; inbox/outbox, idempotency, replay window, bounded retries and reconciliation.
5. Validate uploads; signed object URLs, malware/archive-bomb scans, no arbitrary URL fetch, no untrusted code execution in app processes.
6. AI only on approved paths/documents for approved purposes; recheck permission before model dispatch, enforce deletion/revocation on embeddings and caches, validate citations and tool arguments outside the model.
7. Never auto-waive mandatory release rules; exceptions must be authorized, scoped, time-limited and auditable.
8. Content Security Policy, CSRF with cookie auth, safe CORS, rate limits, least privilege, encryption, safe logs, vulnerability scanning and tested backups.
9. Cross-tenant, IDOR, prompt-injection, role-revocation, skipped-job, wrong-artifact, expired-exception, duplicate-event and restore-after-deletion tests before pilot.
10. No framework, database or AI control alone guarantees security; evaluate with real testing and independent review.
