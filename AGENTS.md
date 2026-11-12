# Navyix implementation agreements

- Continue on the existing `main` branch. Do not create branches unless the user explicitly requests one.
- GitHub Actions remain manual-only (`workflow_dispatch`). Do not dispatch workflows or add push, PR, schedule, release or deployment triggers without the user's explicit request.
- Preserve existing work. Inspect the latest branch head before publishing; use a non-forced, expected-head update.
- Build the actual Design -> Build -> Test -> Readiness product workflow. Authentication, RBAC and infrastructure support that workflow; they do not replace it.
- Never describe planned code, generated tests, local reviews or sample data as executed evidence or authenticated approval.
- The local workbench is not a tenant security boundary. Do not connect customer data or expose business APIs until trusted identity, authorization and tenant-isolation tests are in place.
- Keep domain rules in `packages/workflow/src`. The workbench uses the same code in the Next.js route and in the dependency-free preview. Never edit generated `apps/web/public/workbench` assets directly.
- Run `node --test packages/workflow/test/*.test.mjs` for this increment. Run the full existing policy tests, typecheck, lint and builds when dependencies are available; state exactly what was and was not executed.
- Do not introduce authentication bypasses, default admin credentials, fabricated lockfiles, or secrets in source control.
- Production readiness requires independent evidence provenance, server-side authorization, persistent data storage, audit controls and the documented acceptance gates.
- Follow `docs/DELIVERY_PLAN.md` for sequencing. Prioritize complete-build and real integration blockers before expanding features; implemented-but-unvalidated code is not a completed acceptance gate.
