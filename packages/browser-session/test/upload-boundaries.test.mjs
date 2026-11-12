import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, org, project, requestId } from './support/fixtures.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const path = `/api/browser/api/orgs/${org}/projects/${project}/commands`;
const utf8 = text => new TextEncoder().encode(text);
async function upload(f, login, body, { signal, headers = {} } = {}) {
  return f.handle(new Request(f.config.origin + path, { method: 'POST', body, duplex: 'half', signal, headers: {
    origin: f.config.origin, 'content-type': 'application/json', cookie: login.sessionCookie,
    'x-navyix-csrf': login.details.csrfToken, 'idempotency-key': requestId, ...headers
  } }));
}
function openBody() {
  let controller, cancelled = false;
  const body = new ReadableStream({ start(c) { controller = c; c.enqueue(utf8('{')); }, cancel() { cancelled = true; } });
  return { body, end: () => { controller.enqueue(utf8('}')); controller.close(); }, cancelled: () => cancelled };
}

test('cancelled upload never reaches the workflow API', async () => {
  const f = fixture(), login = await f.login(), signal = AbortSignal.abort();
  const response = await upload(f, login, '{}', { signal });
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BODY_ABORTED'); assert.equal(f.calls.length, 0);
});
test('client disconnect while uploading cancels the stream before dispatch', async () => {
  const f = fixture(), login = await f.login(), data = openBody(), abort = new AbortController();
  const pending = upload(f, login, data.body, { signal: abort.signal }); await tick(); abort.abort();
  const response = await pending;
  assert.equal(response.status, 400); assert.equal(data.cancelled(), true); assert.equal(f.calls.length, 0);
});
test('stalled upload returns a pre-dispatch timeout, not an uncertain write', async t => {
  const f = fixture(), login = await f.login(), data = openBody();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = upload(f, login, data.body); await tick(); t.mock.timers.tick(10000);
  const response = await pending;
  assert.equal(response.status, 408); assert.equal((await response.json()).error.code, 'BODY_TIMEOUT');
  assert.equal(f.calls.length, 0); assert.equal(data.cancelled(), true);
});
test('malformed UTF-8 is rejected before forwarding or changing evidence', async () => {
  const f = fixture(), login = await f.login();
  const response = await upload(f, login, Uint8Array.of(0x22, 0xc3, 0x28, 0x22));
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});
test('invalid JSON does not reach the workflow API', async () => {
  const f = fixture(), login = await f.login(); assert.equal((await upload(f, login, '{')).status, 400); assert.equal(f.calls.length, 0);
});
test('too large declared body returns 413 without forwarding', async () => {
  const f = fixture(), login = await f.login();
  assert.equal((await upload(f, login, '{}', { headers: { 'content-length': '1000001' } })).status, 413); assert.equal(f.calls.length, 0);
});
test('valid JSON including Unicode preserves bytes and original retry identifier', async () => {
  const f = fixture(), login = await f.login(), body = ' { "title" : "தமிழ் 🚀" } ';
  assert.equal((await upload(f, login, body)).status, 200);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.body, body); assert.equal(f.calls[0].init.headers['idempotency-key'], requestId);
});
test('session expiry during an upload prevents dispatch after the body completes', async () => {
  const f = fixture(), login = await f.login(), data = openBody();
  const pending = upload(f, login, data.body); await tick(); f.advance(1800001); data.end();
  const response = await pending; assert.equal(response.status, 401); assert.equal(f.calls.length, 0); assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
test('sign-out during an upload is rechecked before forwarding', async () => {
  const f = fixture(), login = await f.login(), data = openBody();
  const pending = upload(f, login, data.body); await tick();
  const logout = await f.post('/api/browser/logout', login.sessionCookie, {}, { 'x-navyix-csrf': login.details.csrfToken });
  assert.equal(logout.status, 200); data.end(); assert.equal((await pending).status, 401); assert.equal(f.calls.length, 0);
});
test('a failed session recheck never dispatches the mutation', async () => {
  const f = fixture(), login = await f.login(); const get = f.store.getSession.bind(f.store); let count = 0;
  f.store.getSession = async (...args) => { if (++count === 2) throw new Error('database credential hidden'); return get(...args); };
  const response = await upload(f, login, '{}'); assert.equal(response.status, 503); assert.equal(f.calls.length, 0);
  assert.doesNotMatch(await response.text(), /credential|hidden/);
});
test('abort after dispatch retains uncertain-write classification and cancels upstream response', async () => {
  let started, cancelCount = 0, calls = 0;
  const dispatched = new Promise(resolve => { started = resolve; });
  const f = fixture({ fetcher: async () => { calls++; started(); return new Response(new ReadableStream({ start(c) { c.enqueue(utf8('{')); }, cancel() { cancelCount++; } }), { headers: { 'content-type': 'application/json' } }); } });
  const login = await f.login(), abort = new AbortController();
  const pending = upload(f, login, '{}', { signal: abort.signal }); await dispatched; await tick(); abort.abort();
  const response = await pending; assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'BACKEND_UNAVAILABLE');
  assert.equal(calls, 1); assert.equal(cancelCount, 1);
});
test('a stalled acknowledgement after dispatch is 502 and is never automatically resent', async t => {
  let calls = 0; const f = fixture({ fetcher: async () => { calls++; return new Response(new ReadableStream({}), { headers: { 'content-type': 'application/json' } }); } });
  const login = await f.login(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = upload(f, login, '{}'); await tick(); t.mock.timers.tick(15000);
  const response = await pending; assert.equal(response.status, 502); assert.equal(calls, 1);
});
test('non-JSON upstream response is discarded without echoing its data', async () => {
  let cancelled = 0;
  const f = fixture({ fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'text/html' } }) });
  const login = await f.login(); assert.equal((await upload(f, login, '{}')).status, 502); assert.equal(cancelled, 1);
});
test('all proxy write routes inherit bounded-body handling', async () => {
  const f = fixture(), login = await f.login();
  for (const tail of ['commands', 'team/commands', 'github-observations']) {
    const response = await f.handle(new Request(`${f.config.origin}/api/browser/api/orgs/${org}/projects/${project}/${tail}`, {
      method: 'POST', body: '{}', signal: AbortSignal.abort(), headers: { origin: f.config.origin,
        cookie: login.sessionCookie, 'content-type': 'application/json', 'x-navyix-csrf': login.details.csrfToken, 'idempotency-key': requestId }
    }));
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'BODY_ABORTED');
  }
  assert.equal(f.calls.length, 0);
});
test('an already aborted read never contacts the backend', async () => {
  const f = fixture(), login = await f.login();
  const response = await f.handle(new Request(`${f.config.origin}/api/browser/api/orgs/${org}/projects`, { signal: AbortSignal.abort(), headers: { cookie: login.sessionCookie } }));
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});
