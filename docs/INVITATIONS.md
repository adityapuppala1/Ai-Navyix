# Organization invitations — opt-in onboarding increment

Reviewed source base: `main` at `097f7ca477ca56f6d7c8a2f943adf9fc68453bf4`.
This increment implements invitation creation, private code sharing, recipient preview, acceptance, history and revocation for the existing Navyix workspace. It is not deployed or production accepted. Live PostgreSQL, provider and complete framework gates remain unpassed.

## User journey and scope

An existing organization OWNER or ADMIN chooses a recipient, a CONTRIBUTOR/REVIEWER/VIEWER role and an expiry. The server returns an opaque invitation code. The administrator shares it privately; **no email service is connected and no email is sent automatically**. A lost response can be retried with its original request ID to recover the same code without creating another invitation.

The recipient signs in with an account at the configured identity provider, opens `/workspace/invitations`, pastes the code, selects **Verify and review**, then explicitly accepts the displayed organization/role. The code is carried in POST JSON, never a URL parameter, localStorage or an email log. This pilot uses manual code sharing rather than secret-bearing deep links. Identity-provider account signup is separate; the application does not create IdP accounts or collect passwords.

Acceptance requires the configured provider's HTTPS UserInfo response to match the already verified access-token subject and contain boolean `email_verified=true`. A browser-supplied email, an unverified token claim or an existing database email is not proof. Providers must support the configured UserInfo endpoint and the `email` scope. Unsupported/missing proof fails closed; there is no development bypass.

The invitation email preserves local-part case, dots and plus-tags, and lowercases only the domain. The pilot accepts ASCII dot-atom addresses. An administrator must use the exact verified address; aliases and unsupported internationalized addresses are not silently merged.

Acceptance creates an application identity record only when the verified `(issuer, subject)` is new and the email has no conflicting identity. It never links two identities merely because they have the same email. Existing active organization memberships retain their existing role. Inactive users/memberships are not restored. The inviter must still be an active organization administrator for a pending invitation to confer new access. Suspended organizations cannot accept invitations.

**Organization membership does not create project access.** Use the existing project-team workflow afterward. Invitations cannot grant OWNER/ADMIN, transfer ownership, trigger builds, change readiness decisions or authorize releases.

## Configuration and activation

Defaults remain off. Configure API and web separately in isolated development only after the documented acceptance gates:

```env
NAVYIX_API_ENABLED=false
NAVYIX_BROWSER_ENABLED=false
NAVYIX_DIRECTORY_ENABLED=false
NAVYIX_INVITATIONS_ENABLED=false
```

Enabling invitations on the API requires:

- The existing verified OIDC issuer/audience/client/scope configuration.
- `NAVYIX_INVITATION_USERINFO_URL`: the exact operator-approved HTTPS UserInfo endpoint for that issuer. It may use a provider's hosted-login domain; it must not come from request input.
- `NAVYIX_INVITATION_KEY`: a fresh random 32-byte key encoded as 64 hexadecimal characters, distinct from the session key and shared consistently by API replicas. Keep it in the approved secret store, never source control or chat.
- All reviewed migrations, including `202611120007_organization_invitations`, and restricted application database credentials.

On the web, INVITATIONS enables the page/navigation and requests the additional `email` scope during sign-in. Enable DIRECTORY for named administrator organization selection. An existing session may need a new sign-in to obtain that scope. No API invitation key belongs in public browser configuration.

The administration screen currently displays the first organization-directory page (at most 50 organizations) and explicitly warns if more exist. Invitation lists page at 20 records. Users without an administrable organization may still accept invitations.

## API contract

All endpoints require the existing verified API access token; browser users use the existing cookie/CSRF session proxy. Mutations also require `Idempotency-Key: UUID`.

- `GET /v1/orgs/:org/invitations?limit=20&after=UUID`: administrator-only history, without codes or hashes.
- `POST /v1/orgs/:org/invitations`: `{ "email": "Recipient@example.com", "role": "VIEWER", "hours": 24 }`.
- `POST /v1/orgs/:org/invitations/:invitation/revoke`: `{}`; never removes an already accepted membership.
- `POST /v1/me/invitations/preview`: `{ "code": "nvi1.…" }`; verifies recipient and returns the offered organization/role without accepting it.
- `POST /v1/me/invitations/accept`: the same code-only body; explicit atomic acceptance.

Accepted expiry is 1–72 hours, default 24. The UI offers 24/48/72. Unknown or invalid identity/role fields are rejected. Invitation API bodies are bounded at 4 KB. Preview and acceptance never take an org ID, email, subject or role from the browser.

The UI preserves the exact pending request on an uncertain response and provides explicit retry. A confirmed save followed by a failed list refresh is labeled saved; it must not be submitted as a new creation. Codes are removed on sign-out, organization change, hiding, or page disposal. Reloading loses an unconfirmed in-memory request ID; administrators can inspect/revoke a pending invitation and create a replacement rather than guess a new key.

## Persistence and security boundary

The new `navyix_invitations` schema is managed by the explicit SQL migration, like the existing private browser-session schema. It holds an invitation table and idempotency receipts. Both force RLS. The runtime role receives no direct table or membership mutation grant; it may invoke one guarded function.

The function owner is a separate NOLOGIN, non-superuser, non-owner, NOBYPASSRLS role, never granted to the application login. The function has a fixed `pg_catalog, pg_temp` search path, qualified table/type references and current-account/admin checks. It uses bounded serializable transactions and per-organization locking. The application supplies verified issuer/subject and, only after UserInfo verification, recipient email as transaction-local context.

Creation stores a SHA-256 hash of the code, not plaintext. The code is an HMAC-SHA256-derived opaque value bound to creator identity, organization, request ID and normalized request. This permits an authorized identical-request retry without storing the code. Its HMAC is not an identity token, release signature or attestation. The secret key must be protected. Rotating the key stops recovery of older create responses; already issued codes remain valid until consumed, revoked or expired. A compromised key requires revocation of affected pending invitations as well as rotation.

Acceptance atomically consumes the code, creates only the allowed missing identity/membership, appends an audit event and records the request receipt. Duplicate request IDs with different inputs conflict. Replays reauthorize; a revoked membership is never restored by replay. Concurrent failures roll back rather than partially granting access. Successful create/revoke/accept events are audited without token values. Failed attempts, previews and reads are not durably audited by this increment.

As elsewhere, database session context is not proof against arbitrary application compromise. The shared DB login must remain protected, and the API verifier/UserInfo binding are part of the security boundary. Query-text tests cannot prove the SQL function or its policies are safe. Review and run the live suite before enabling this migration's functionality.

## Pilot bounds and remaining work

The function limits each organization to 50 live pending invitations and 200 retained invitation records. There is no silent eviction. Retention/deletion workflows and administrative membership restoration are separate work. UserInfo has a five-second deadline, 32 KB response limit, bounded chunk count, four concurrent requests per process and short subject backoff. These are process-local guards, not distributed rate limiting or a production abuse-control program.

No automated mail delivery, resend campaign, provider signup, multi-provider account linking, automated deployment or hosted AI is enabled. Production rollout still needs complete builds, actual SQL/role tests, real provider login/UserInfo, real browser-origin cookie behavior, distributed quotas, log review, retention, accessibility, cross-browser and recovery acceptance.

## Verification and rollback

```sh
node --test packages/server/test/invitation*.test.mjs packages/browser-session/test/invitation*.test.mjs
python tests/invitations_browser.py
# Strict mode: only a migrated disposable DB with all declared dependencies:
NAVYIX_REQUIRE_INTEGRATION=1 node --test packages/server/test/invitations-live.test.mjs
# The existing explicit disposable lab now includes invitations-live.test.mjs:
node scripts/integration-lab.mjs --run --full --report ../navyix-acceptance-result.json
```

On PowerShell set `$env:NAVYIX_REQUIRE_INTEGRATION='1'` before running Node. Never use a customer DB for acceptance tests. The generic strict test-workspace runner also discovers this suite. The offline browser harness uses the actual component/client but synthetic APIs; it does not send an invitation or prove SQL membership behavior.

To roll back the feature, disable INVITATIONS on API and web. Preserve invitation/audit records. Do not drop customer data or weaken policies to roll back the interface. Database migration, feature activation, provider configuration and real email delivery were not performed in this increment.

References: OpenID Connect Core UserInfo/subject and email_verified requirements (https://openid.net/specs/openid-connect-core-1_0.html); OWASP token lifetime/single-use guidance (https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); PostgreSQL secure function ownership/search paths (https://www.postgresql.org/docs/17/sql-createfunction.html). These explain control goals, not acceptance of this implementation.
