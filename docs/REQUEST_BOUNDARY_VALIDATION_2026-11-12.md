# Browser request-boundary validation — 12 November 2026

Reviewed base: main at e7d6ee59f71f783a1e317c7b5661796752af059a.

## Reproduced problem

The existing limitedText function waited on reader.read() without a read deadline or request-abort handling. A real Fetch Request containing an unfinished ReadableStream remained pending after its AbortController was aborted. A separate malformed UTF-8 byte sequence was decoded with a replacement character instead of being rejected. These are executable helper reproductions, not a reported customer incident or a demonstrated production denial of service.

The standalone baseline function was extracted verbatim from the current oidc.mjs blob d9b275007c5154e38b5ade1cecb77cea20410a25 to avoid unrelated unavailable imports. After aborting the upload and waiting 50 ms, request.signal.aborted was true and the reader promise had not settled. The fixture was explicitly closed afterward. The malformed sequence decoded as a string containing U+FFFD.

## Implementation

- New server-only body.mjs supplies a byte-counted, chunk-counted, fatal-UTF-8 reader. Uploads and token bodies have a 10-second total read deadline; API response reading is bounded by the shared 15-second upstream deadline. This is not a refreshed idle timeout.
- Request abort is observed even while a read is pending. A maximum of 8192 delivered chunks also bounds pathological immediate empty-chunk loops. Internal limit options are not taken from HTTP inputs.
- Oversized, malformed-length and invalid-UTF-8 data is rejected. Reader locks/listeners/timers are released; failing cancellation hooks are not awaited indefinitely. Non-JSON/error upstream bodies are discarded best-effort.
- Browser uploads recheck the session after body parsing and before forwarding. This catches expiry/sign-out during a stalled upload. It does not make session deletion atomic with an already dispatched backend transaction.
- A rejected/aborted/timed-out upload before dispatch cannot reach the workflow API. After dispatch, cancellation, timeout or a malformed acknowledgement stays a 502 uncertain outcome. No automatic replay or request-ID replacement is added; an operation may already have committed.
- OAuth nonce, issuer, audience, signature-verification configuration, roles, readiness rules, database schema, cookies and feature defaults are unchanged. oidc.mjs reexports limitedText for the existing internal contract. Only server modules import the new reader; no credentials or server module is copied into public workbench assets.

These source changes preserve the existing Design / Build / Test / Readiness application and do not add another feature screen.

## Executed checks

Environment: Linux working container; Node v22.16.0. DNS resolution for registry.npmjs.org and github.com failed. pnpm, PostgreSQL and Docker were not present; the authorized Desktop Commander device was offline. Repository content was inspected through the GitHub connector. This is a sparse working copy, not a full checkout.

Command:

```sh
node --test packages/browser-session/test/body.test.mjs packages/browser-session/test/upload-boundaries.test.mjs packages/browser-session/test/session.test.mjs packages/browser-session/test/oidc.test.mjs packages/browser-session/test/http.test.mjs
```

**Result: 127 tests, 127 passed, 0 failed, 0 cancelled, 0 skipped, 0 TODO.**

- 28 reader tests: valid Unicode and multibyte boundaries, exact byte limit, declared/streamed oversize, malformed lengths, invalid/truncated UTF-8, total deadline and drip-feed, aborted requests, stalled cancellation, cleanup, empty-chunk bounds and redaction. One starts an actual loopback Node HTTP server and verifies a never-ending response is timed out and disconnected.
- 15 browser-proxy tests: pre-dispatch cancellation/timeouts, invalid bodies, unchanged request content/ID, expiry and logout during upload, session-store failure, post-dispatch uncertainty, upstream cancellation and write-route coverage. They use the current real handler with test sessions/upstream responses. Two tests use Node's scoped mock timers to advance the fixed deadlines; other timeout/abort tests use real timers/signals.
- 84 existing session, token-claim-policy and local HTTP regressions. Provider signature verification and storage are substituted in those tests; they are not real OIDC/PostgreSQL integration.

An earlier 43-test new-only run and 84-test existing-only run passed too. Those are the same cases repeated, not 254 unique tests. The final combined run above is the reported count. JavaScript syntax checks passed for all changed/new modules and tests.

Reused config, cryptography, authentication, error, fixture and existing test sources were matched to their current Git blob hashes. The handler was reconstructed from the prior source plus already committed route updates and verified against current blob 7ae0b692f933b719cad26a9b8b6584bb5f21d4a1 before editing. The first reconstruction failed its hash check because of a route-expression difference; it was corrected and verified before the application changes were made.

## Not executed

No full-workspace/policy/workflow regression, package install/audit, genuine lockfile generation, semantic TypeScript check, ESLint, Prisma generation/validation, Next/Nest/container build, migration, PostgreSQL/RLS test, live provider login or GitHub request, real-origin rendered browser test, accessibility/OS matrix, load test or production deployment. The original core-workflow test files were not present in this sparse source copy; no zero-test result is counted as a pass.

No production capacity or security certification is implied by these focused checks. Upstream/proxy/server-level request limits, distributed quotas, tracing, and real deployment disconnect behavior remain acceptance work. A client cancellation after dispatch is not a transaction rollback guarantee.

No dependency manifest, database migration, runtime feature flag or GitHub workflow definition is changed. No workflow is dispatched, customer data transferred or paid resource provisioned. Follow the existing delivery plan: complete builds, actual database/cryptographic validation and the connected two-organization browser journey precede additional feature scope.

## References

- Node.js v22 Web Streams: https://nodejs.org/docs/latest-v22.x/api/webstreams.html
- Node.js v22 AbortSignal: https://nodejs.org/docs/latest-v22.x/api/globals.html#class-abortsignal
- OWASP REST input and request-size guidance: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

References explain the underlying APIs and control goals; they do not establish application acceptance.
