# Connected browser workflow — implementation and acceptance gates

## Product scope and current status

This increment adds an opt-in browser session and transport to the existing Design -> Build -> Test ->
Readiness workbench. It does not replace that product with an authentication application, duplicate the
readiness engine, run customer builds, start CI, or connect a hosted AI model.

The default remains the existing local preview. `NAVYIX_BROWSER_ENABLED=false` is the browser default;
`NAVYIX_API_ENABLED=false` remains the backend default. The new code is NOT a validated customer deployment.
Read `VALIDATION_2026-11-12.md` before enabling it. Registry downloads, full Next/Nest builds,
real identity-provider login, real PostgreSQL and the integrated browser journey remain acceptance gates.

## User journey once configured and validated

The existing `/workspace` route selects the connected component only when the server-side browser flag
is explicitly enabled. A query parameter cannot turn it on or bypass authentication. The user signs in
through the configured organization identity provider, enters their administrator-provided organization
UUID, selects a permitted project, and uses the existing requirements/design/build/test/readiness screens.
Knowing an organization UUID does not grant membership. A membership picker and invitations remain later work.

Server mode reuses `apps/web/workbench/app.mjs` through a native component subclass. Its transport layer
never reads or writes preview localStorage. Local records, sample data, local reviews and credentials are
not automatically uploaded. Project creation submits only name, goal, owner label and environment; the
server creates the identity. Existing-project commands use expected revisions and idempotency UUIDs.

The adapter loads readiness from the existing server endpoint for all four stages. It refuses to combine
assessments from a different project revision. Network-ambiguous saves retain their exact request ID and
body for retry; a known conflict requires reload. An acknowledged save followed by a failed refresh is
reported as saved-but-not-refreshed, not a new operation to submit again. Exports recheck access through
the API. Late responses from a previous organization cannot repopulate a new organization's state.

The interface is not the authorization boundary. Organization/project roles are checked by the existing
backend on each operation. Buttons are not yet a complete role-aware capability display; a prohibited
operation receives the backend's permission error. Readiness remains advisory and manual build/test
records remain unverified evidence even after server persistence.

## Authentication and session boundaries

1. A same-origin POST starts Authorization Code + PKCE (S256), random state and nonce.
2. A ten-minute transaction is encrypted in the dedicated session database and bound to an HttpOnly
   login cookie. Atomic DELETE RETURNING consumes the transaction once across replicas.
3. The callback validates the binding/state and optional response issuer, exchanges the code only with
   the statically configured token endpoint, and validates ID and API access tokens through JOSE.
   ID-token issuer, audience, nonce, timestamps, authorized party and optional access-token hash are
   checked. The access token uses the same claim policy as the existing API, including its required scope.
4. A new opaque session ID replaces the previous one. Only its SHA-256 hash is stored as the lookup key.
   Tokens and CSRF data are authenticated/encrypted with Node AES-256-GCM and record-specific AAD.
5. The browser gets a Secure, HttpOnly, host-only, SameSite=Lax cookie, not a bearer token. CSRF values
   are returned by a no-store session endpoint and retained only in JavaScript memory.
6. The same-origin forwarding handler checks Origin and CSRF for changes, accepts only named API
   paths/methods/query parameters, and injects the server-held access token. Incoming bearer tokens,
   arbitrary destinations, redirects, and upstream cookies are not accepted or forwarded.

Sessions expire at the earlier of token expiration and one hour, with a 15-minute idle limit. There is
no refresh-token storage or refresh automation. Reauthentication is intentional in this increment.
Logout deletes the server session and clears the cookie; it does not sign out every identity-provider
application or revoke every already-issued provider token. Existing application membership suspension
continues to deny access through the API. Already authorized in-flight work may complete.

Login/client secrets, API tokens, cookie IDs and connection strings must not appear in logs. The
implementation redacts callback/provider errors and does not forward upstream response headers.
Protected content is no-store. Browser session data is cleared on sign-out, expired sessions, page hiding,
and cross-tab sign-out. Actual browser/back-forward-cache behavior still needs integration verification.

## Configuration

Copy `apps/web/.env.browser.example` into `apps/web/.env.local`, using real development values locally.
Do not commit it or prefix server secrets with `NEXT_PUBLIC_`. Next reads this project-local file; the
backend retains its separate root/API environment configuration.

Configure a single reviewed provider/client and exact callback URL:

```text
https://YOUR_WEB_HOST/api/browser/callback
```

Use the same issuer, JWKS URL, API scope and access-token profile as the backend. Generic `jwt-access`
expects an API audience and at+jwt access tokens; `cognito-access` expects the configured Cognito client
and access token_use. ID tokens are never sent to the business API.

Authorization/token endpoints are pinned in configuration, not discovered from an uploaded document or
browser input. Configure `client_secret_basic` and the confidential client secret, or explicitly choose
`none` for a provider-registered public PKCE client. Only openid and the required API scope are requested.
The public web and backend origins must be distinct. Production requires HTTPS and verified PostgreSQL
TLS (`sslmode=verify-full`). Reverse-proxy routing must preserve the configured public origin and must
be tested; the handler does not trust arbitrary forwarded-host headers.

HTTP is permitted only for explicit loopback origins when NODE_ENV is not production and
`NAVYIX_ALLOW_HTTP_LOOPBACK=true`. It uses separate development cookie names. This is not an identity
bypass: the identity provider still uses HTTPS and real signed tokens.

Generate the session encryption key locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the same secret across web replicas and outside source control. Rotating this key invalidates old
sessions and pending logins; staged multi-key rotation is not implemented. Never use the public test key.

## Database and deployment boundaries

Use the separate `navyix_browser` login, not the application, database-owner or migration login.
An administrator explicitly reviews and runs `apps/api/prisma/browser-roles.sql`, sets a fresh password
with `psql`'s `\password navyix_browser`, and applies the new additive Prisma SQL migration as the
migration identity. Follow the existing server guide for the earlier application roles/migration.

The migration adds only `browser_auth.login_transactions` and `browser_auth.sessions`. It does not
alter existing customer tables or RLS policies. These raw SQL-managed session tables intentionally have
no Prisma models; do not use db push/reset to remove them or bypass drift checks.

The dedicated login has namespace usage, constrained record operations and only idle_until column
updates. Startup rejects elevated roles, role memberships, schema/database/table ownership, schema
creation, customer-table privileges and publicly callable security-definer functions in the public
schema. These guards and SQL permissions still need verification against the actual database.

Session storage is persistent and shared between replicas. There is no in-memory production fallback.
The in-memory adapter exists only under tests. The web runtime cannot read customer data directly;
it forwards a verified token to the separately authorized API.

Before any public pilot, configure ingress rate limits for login/callback/API requests, body/time limits,
TLS/proxy settings, CSP, monitoring, access review, secure cookie/browser checks and backups. No edge
rate limiter, deployment or production monitoring resource is installed by this increment. Expired rows
must be cleaned by explicit operations maintenance (the repository's `cleanup()` method or reviewed SQL).
No scheduled CI workflow is created. Review cleanup frequency, retention and key rotation before scaling.

## Verification and next gates

Dependency-light tests are cross-platform through the Node runner:

```sh
node scripts/test-browser.mjs
```

The suite reports real JOSE and PostgreSQL checks as skipped when their prerequisites are missing.
For the strict gate, install declared dependencies and set NAVYIX_TEST_BROWSER_DATABASE_URL to the
restricted login on a migrated disposable database, plus NAVYIX_TEST_DB_CONFIRM=disposable:

```sh
node scripts/test-browser.mjs --integration
```

Strict mode fails when prerequisites are absent. The JOSE integration uses real generated signatures
and local test keys; it does not prove external JWKS/provider connectivity. The PostgreSQL integration
verifies the session identity and single-use/revocation behavior, not all business RLS paths. Run the
previous server's strict integration suite as well.

After resolving and reviewing a real dependency lockfile, run Prisma validation, semantic type checks,
ESLint, all existing regression suites, both framework builds and container builds. Then validate the
actual Next route and Nest API with a real development provider and database: sign-in, two organizations,
role restrictions, create/review/design/build/test/fail/retest/assess, logout, expiry, conflicts, cross-tab
behavior, accessible keyboard use, mobile layouts, downloads, Firefox and WebKit.

The next feature work is organization/project membership administration and independently identified
CI evidence, followed by approved-source AI. Do not turn on customer access merely because unit checks pass.

## References

- OpenID Connect Core: https://openid.net/specs/openid-connect-core-1_0.html
- OAuth security best current practice: https://www.rfc-editor.org/rfc/rfc9700.html
- OWASP session management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Next.js authentication guidance: https://nextjs.org/docs/app/guides/authentication

These references describe the underlying practices. They do not certify this implementation.
