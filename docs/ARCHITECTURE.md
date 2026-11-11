# Navyix architecture — ADR-001
## Baseline
Next.js + React + TypeScript web; modular NestJS TypeScript API; PostgreSQL/Prisma; S3 evidence storage; SQS asynchronous jobs; separate ingestion, policy and AI workers; ECS Fargate/RDS AWS deployment. Hosted AI behind an adapter with per-tenant budgets. Customer code must execute ONLY in isolated CI runners, never the web/API/AI workers.
## Bounded contexts
Identity/memberships; organizations; projects; requirement versions; design decisions; integrations; build/test evidence; policies; assessment snapshots; reviews and exceptions; AI grants; jobs; audit; reporting.
## Evidence contract
Every readiness statement binds tenant, project, activity, build digest, environment/configuration identity, policy version and evidence version. `UNMET`, `UNKNOWN` and `STALE` differ. Accepted exceptions preserve underlying failure and expire. Historical assessments remain immutable.
## Security
OIDC authentication, RBAC project grants, restricted DB runtime role, transaction-scoped PostgreSQL RLS and tenant-aware relations. Enforce boundaries in files, search, AI retrieval, caches, queues, exports and subscriptions. No unauthenticated business routes before OIDC/RBAC implementation.
## Processing
Verified GitHub webhooks -> durable inbox -> transaction/outbox -> SQS -> idempotent workers -> normalized evidence -> impacted assessment. Retries with backoff, dead-letter queues, reconciliation and recovery for ambiguous external results.
## Scale
Separate web/API/worker services to scale by load. 2 availability zones and managed RDS backups for production. No GPU required if using hosted inference. Actual capacity must be validated by load tests.
