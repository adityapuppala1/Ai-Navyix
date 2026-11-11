# Navyix full SDLC implementation plan
**Team:** 3–5 engineers. **Branch:** main. **CI:** manual only. **Pilot:** 2–5 invitation-only organizations.
## Definition of the first complete journey
Invite a member -> create a project -> connect a selected GitHub repository -> approve AI source access -> version requirements/design -> import exact build and executed test -> evaluate a readiness policy -> inspect evidence/blocker -> assign an action -> reevaluate -> export recorded decision. Confirm a second tenant cannot view any of the first tenant's records, files, search or AI retrieval.
## P0 Discovery and UX (weeks 1–2)
Interview PM/QA/dev/release roles; user journeys; terminology; IA and responsive wireframes; RBAC matrix; threat model; design tokens; WCAG 2.2 AA target; performance budgets; representative test data; source/AI governance policy.
## P1 Secure foundation (weeks 3–5)
Trusted OIDC sessions, invitation and MFA policy; org and project membership; PostgreSQL migrations + restricted runtime and RLS; signed object paths; tenant-aware APIs; audit; mobile shell; admin; stage infra and local dev. Security gate: cross-tenant negative tests.
## P2 Core evidence (weeks 6–9)
Requirement revisions, design reviews, traceability, GitHub App and verified webhooks; durable inbox/outbox/reconciliation; immutable build digest/test outcomes; versioned policy DSL + deterministic evaluator; blockers and evidence drawer; report exports. Must prove two real isolated tenants.
## P3 Workflow and AI (weeks 10–13)
Review inbox, permitted scoped exceptions, assignments; AI approval scoped by repository paths and use purpose; per-job reauthorization; provider adapter, RAG, citations, budgets and evals; requirement gap suggestions and assessment explanations. AI drafts require review and cannot set readiness.
## P4 Pilot hardening (weeks 14–18 reference, staffing-dependent)
Accessibility, mobile and cross-browser review; security and SCA; 150-user representative load and event burst; backup/restore and deletion-after-restore drills; observability and runbooks; 2–5 invited tenants; release acceptance.
## Team allocation and durations
Front end/UX engineer; backend/RBAC/policy engineer; integration/AI engineer; 4th platform/DevOps engineer; 5th QA/full stack. Planning range: 18–24 weeks with 3, 14–18 with 4, 12–16 with 5; dependent on shared QA/security/design and scope.
## Standard ticket Definition of Done
Requirement and acceptance criteria; threat/RBAC impact; technical design; documented API/data contract; accessibility and responsive states; failing and success paths; unit/contract/integration/E2E test evidence; logs/traces; reviewed rollout/rollback; staging verification; and owner approval. Closed issue != passed readiness gate.
## Phase-gated later scope
Enterprise SSO/SCIM; billing; hosted customer-code runners; auto merge/deploy gates; advanced diagrams; more integrations; autonomous code changes; enterprise dedicated tenancy.
## Sample first sprint tickets
NAV-001 repo setup/docs/manual CI; NAV-002 resolve deps, lockfile, local full build; NAV-003 schema and migrations; NAV-004 OIDC and invite/session; NAV-005 RBAC/RLS tests; NAV-006 accessible shell and mobile navigation; NAV-007 audit; NAV-008 security review.
