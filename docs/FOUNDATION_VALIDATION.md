# Foundation validation and first implementation gate

## Current scope
The application is an early scaffold, not an authenticated multi-tenant SaaS. The API only exposes health endpoints. The policy package contains pure readiness and authorization decision helpers; no route is protected by the new helper until trusted OIDC and database membership lookup are wired in.

## Commands on a network-enabled developer machine
1. Install Node.js 22 and pnpm 9.15.9.
2. Run `corepack enable` and `corepack prepare pnpm@9.15.9 --activate`.
3. Run `pnpm install --no-frozen-lockfile` **once** to resolve dependencies and generate `pnpm-lock.yaml`; review and commit that lockfile to the existing main branch.
4. Thereafter change the manual-only workflow to `pnpm install --frozen-lockfile`.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
6. Start local PostgreSQL with `docker compose up -d`, configure local environment variables using `.env.example`, then run Prisma validation/migrations and verify the API health endpoint.
7. Start the web app, verify desktop/tablet/mobile layouts, reduced motion, keyboard access and WebGL fallback.
8. Record command output, dependency audit findings and any failures before claiming the build is verified.

## Security gate before business endpoints
- Verify OIDC issuer, audience, signature, expiry and token type.
- Resolve active organization/project memberships from trusted storage for each request.
- Enforce scoped actions in backend services; use PostgreSQL RLS as defense in depth.
- Test tenant isolation for API, object access, search, jobs, event streams and AI retrieval.
- Ensure that organization and project IDs supplied by clients are not trusted as authorization.
- Never run customer repository code inside API or ingestion containers.

## CI policy
The only workflow is manually invoked with `workflow_dispatch`. Do not add push, pull_request, schedule, or deployment triggers without explicit user approval. Do not manually dispatch it without user request.

## Next deliverable
A fully compiled and validated dependency lockfile followed by trusted identity, tenant membership storage and negative cross-tenant integration tests.
