# Navyix delivery plan — consolidation baseline

Updated: 12 November 2026. Reviewed source: main at d0f0d6cf259383d270272ca6de69983c3c94a241.
This plan sequences the existing implementation; it does not replace the product or claim completed acceptance.

## Confirmed direction

Build a multi-customer Design -> Build -> Test -> Readiness SaaS. Hosted AI may process only approved source code/documents. Team capacity is 3–5 engineers. Remain on main; no new branch, automatic CI trigger, workflow dispatch, customer migration or deployment without the required explicit user instruction.

The first customer outcome is one traceable journey: requirements, reviewed designs, exact build, test definitions/results, explainable readiness, blocker resolution and retained assessment history. RBAC, source integrations and AI support this journey. They are not separate replacement products.

## Current evidence-based status

| Area | Source implementation | Acceptance still needed |
| --- | --- | --- |
| Local project/requirements/design/build/test/readiness | Implemented in earlier increments | Full current regression and real-origin browser checks |
| Backend identity, tenant/project access and PostgreSQL storage | Implemented, opt-in | Actual migrations, restricted-role/RLS, concurrency and revocation |
| Browser sign-in and server workspace | Implemented, opt-in | Real provider login, browser cookies/CSRF and persisted workflow |
| Project-member role management | Implemented for existing members | Real role changes, ownership protection and two-organization tests |
| GitHub inspection and saved history | Implemented, opt-in | Actual provider access, SQL persistence and deployment checks |
| Dependency lockfile and complete builds | BLOCKED, not passed | Network-enabled dependency resolution and reviewed lockfile |
| Invitations / tenant lifecycle / hosted AI | Not delivered | Product implementation after the preceding gates |
| Production operations and customer pilot | Not accepted | Restore/load/security/browser acceptance and operating runbooks |

Do not add together historical focused test counts or describe them as a full release pass. No live customer should be onboarded on the strength of mocked SQL, offline component tests or compilation syntax alone.

## Immediate consolidation changes

1. Session runtime: share initialization, bound failed-startup retries, retain a healthy handler/pool after request errors, and clean up unsuccessful pool setup. Provider setup precedes pool allocation.
2. Image boundary: deny-by-default Docker context, exclude environment/registry/key files and local outputs, and generate the known non-secret npm setting inside each image. Dockerfiles now require a real lockfile and frozen dependency installation. Missing lockfile is an intentional hard failure, not an invitation to invent one.
3. Database shape guards: an additive migration requires explicit true for workflow and snapshot JSON constraints. It validates existing rows before removing the old constraints and never deletes or repairs data. An invalid existing row or lock timeout stops the transaction. Review and resolve the underlying issue; do not disable constraints to force deployment.
4. Real SQL regression: add 22 nested cases for absent/null/wrong fields and preservation of valid records to the existing disposable acceptance lab. These have not run here.

The image configuration is a development baseline, not a certified final production image. Digest-pinned base images, dependency pruning, SBOM/security scanning and actual image inspection remain part of G1/G6. Private-package credentials must use an approved build-secret mechanism, not a copied .npmrc or build argument.

## Ordered delivery gates

### G1 — Reproducible application build (P0; platform + full-stack)

Use a complete checkout, Node >=22.16.0 and the repository's pnpm 9.15.9. Resolve dependencies once on an authorized network-enabled machine, inspect package changes and security findings, generate/review the genuine pnpm-lock.yaml, then commit it on main. Reinstall frozen from a clean directory to demonstrate reproducibility.

Run the current complete test inventory, Prisma validation/generation, semantic typecheck, lint, Next/Nest production builds, and both Docker builds. Do not weaken assertions, TLS or permission controls to turn a failure green. The current execution environment cannot resolve the npm registry; the connected developer computer is offline. No paid resource or remote deployment is authorized merely to bypass this blocker.

Exit evidence: commit/lockfile identity, commands, versions, complete test inventory, audit triage, production-build logs, image digests and secret-exclusion inspection. A registry check, an installed manifest, or a syntax-only transpilation is not this gate.

### G2 — Real database and cryptographic acceptance (P0; backend + platform)

Use only the explicitly disposable environment described in ACCEPTANCE_LAB.md. Review all migrations, including project-team functions and strict shape guards. Run real JOSE verification and every server/browser/team/journal/shape live suite. Verify application, migration and browser credentials remain separate. Exercise simultaneous edits, idempotent retry, role changes, revocation and connection-pool tenant-context reuse.

The existing lab is explicitly invoked with `node scripts/integration-lab.mjs --run --full --report ../navyix-acceptance-result.json`. It does not install dependencies or silently pull images. No customer database URL belongs in this run.

Exit evidence: zero failed/cancelled/TODO/skipped strict tests, all migration outcomes, runtime-role/RLS results and cleanup confirmation. A test double or a query-text assertion does not establish SQL authorization.

### G3 — Connected user journey (P0; frontend + QA/full-stack)

Configure an approved development OIDC provider and two test organizations. Enable the relevant flags only in isolated development. Run the rendered Next workspace through real sign-in, creation, editing, failed/passing test imports, readiness and saved assessment. Repeat with owner, contributor, reviewer and viewer accounts. Verify reload persistence, expiration, logout/cross-tab cleanup, CSRF failures, exact-target response validation and foreign tenant IDs.

Exercise team and evidence/history screens through the same session. Actual GitHub inspection remains read-only; green job metadata must not become artifact/test proof or a release approval.

Exit evidence: real-origin browser tests/screenshots, API/database traces without secrets, actual downloaded exports, and independently denied cross-organization requests. Offline synthetic component results are useful regressions, not this gate.

### G4 — Customer lifecycle (P1; backend + frontend)

Implement bounded invitations and acceptance, organization discovery, member removal/suspension, project-access administration, quota visibility, export and deletion/retention procedures. Use verified identities; a browser-supplied email or role is not authorization. Invitation tokens must be scoped, expiring, single-use and safely stored; do not silently enable automated email or subscription billing.

Exit evidence: invited customer can onboard without an operator distributing organization UUIDs; misuse, replay, revocation and ownership-loss scenarios are tested. Billing/commercial policies require separate confirmation.

### G5 — Approved-source AI and evidence completion (P1; integration/AI + backend)

First AI workflows: requirement gap review and explanation of an existing readiness assessment. Create explicit tenant/project/source/purpose/provider approval records and recheck them at execution. Enforce source access before model context construction, budgets, bounded inputs, structured output and source references. Suggestions remain drafts. Use a reviewed evaluation set and adversarial/access cases before enabling provider calls. Provider, model, region, retention and customer approvals must be configured, not guessed.

Separately associate collected build/test results with exact artifacts, environments and versioned requirements. Add durable ingestion/reconciliation and shared quotas before scaling. Preserve the distinction between manually supplied evidence, observed provider metadata and verified report/artifact relationships. No autonomous merge/deploy or AI readiness overrides.

Exit evidence: evaluated AI drafts with documented limitations, verified grant revocation, independently checked source associations and negative provenance tests. Neither prompt compliance nor an observation checksum proves correctness.

### G6 — Controlled customer pilot (P0 before customer access; shared team)

Complete browser/device coverage, keyboard/screen-reader/reduced-motion review, agreed load tests, backup/restore drills, secrets/key rotation, retention/deletion, alerts, support ownership and incident/runbook exercises. Establish operating budget and measured capacity; prior user-load numbers are targets, not measured guarantees. Confirm rollback without destructive data reversal. Obtain explicit release/deployment approval.

Exit evidence: release-candidate digest, acceptance checklist with real evidence, security findings triaged, measured restore/load outcomes and a named pilot support owner. Production flags remain off until the gate is accepted.

## Staffing without parallel scope creep

| Capacity | Allocation |
| --- | --- |
| 3 engineers | Frontend; backend/security; platform/integrations. Share QA and defer extra connectors. |
| 4 engineers | Add dedicated integration/AI ownership after G1–G3; keep platform separate. |
| 5 engineers | Add QA/full-stack capacity for real browser/integration and accessibility coverage. |

Use role ownership until named engineers are assigned. Do not multiply timelines linearly or promise dates before G1 exposes the actual build backlog. During G1–G3, product work is limited to fixes needed for the complete journey; optional new dashboards and connectors wait.

## Commands and operational boundaries

`node scripts/test-workspace.mjs --list` identifies inventory; `node scripts/test-workspace.mjs` runs the ordinary suite; `node scripts/verify-workspace.mjs --full` requires configured dependencies. The separate strict lab provisions only its own disposable local database when explicitly requested with --run. See the existing guides for credentials and prerequisites. Do not post credentials in chat or commit .env files.

No CI trigger is changed by this plan. Do not dispatch the manual workflow on a generic request to continue coding. Production deployment and customer migration remain separately authorized actions.

## References for this consolidation

- PostgreSQL CHECK constraints and SQL NULL: https://www.postgresql.org/docs/current/ddl-constraints.html
- Docker build-context exclusions: https://docs.docker.com/build/concepts/context/
- Docker build secrets: https://docs.docker.com/build/building/secrets/
- pnpm installation/lockfile options: https://pnpm.io/cli/install

These references explain platform behavior, not acceptance of this application.
