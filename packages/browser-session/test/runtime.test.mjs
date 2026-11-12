import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserRuntime } from '../src/runtime.mjs';
const request = () => new Request('https://navyix.example/api/browser/session');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('disabled by default: never initialize or process a request', async () => {
  const serve = createBrowserRuntime(() => { throw new Error('must not initialize'); });
  const result = await serve(request());
  assert.equal(result.status, 503); assert.equal((await result.json()).error.code, 'BROWSER_DISABLED');
});
test('only a boolean true enables the boundary', async () => {
  for (const enabled of [false, undefined, 'true', 1]) {
    let initialized = false;
    const serve = createBrowserRuntime(async () => { initialized = true; }, { enabled: () => enabled });
    assert.equal((await serve(request())).status, 503); assert.equal(initialized, false);
  }
});
test('concurrent initial requests share one initialization and handle each request', async () => {
  const init = deferred(); let count = 0, handled = 0;
  const serve = createBrowserRuntime(() => { count++; return init.promise; }, { enabled: () => true });
  const requests = Array.from({ length: 30 }, () => serve(request()));
  await tick(); assert.equal(count, 1);
  init.resolve(async () => { handled++; return Response.json({ ok: true }); });
  for (const result of await Promise.all(requests)) assert.equal(result.status, 200);
  assert.equal(handled, 30); await serve(request()); assert.equal(count, 1);
});
test('startup failure is redacted and logs once for one shared attempt', async () => {
  const codes = []; let count = 0;
  const serve = createBrowserRuntime(async () => { count++; throw new Error('postgres://admin:secret@host/db'); },
    { enabled: () => true, onError: code => codes.push(code) });
  const results = await Promise.all(Array.from({ length: 8 }, () => serve(request())));
  for (const result of results) { assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /postgres|secret|admin/); }
  assert.equal(count, 1); assert.deepEqual(codes, ['NAVYIX_BROWSER_STARTUP_FAILED']);
});
test('failed startup retries only after cooldown and shares the retry', async () => {
  let time = 100, count = 0;
  const serve = createBrowserRuntime(async () => {
    if (++count === 1) throw new Error('temporary'); return async () => Response.json({ ok: true });
  }, { enabled: () => true, clock: () => time, retryAfterMs: 1000 });
  assert.equal((await serve(request())).status, 503);
  time = 1099; assert.equal((await serve(request())).status, 503); assert.equal(count, 1);
  time = 1100;
  const results = await Promise.all([serve(request()), serve(request())]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal(count, 2);
});
test('request exceptions do not orphan a successful initialization or create another pool', async () => {
  let created = 0, calls = 0; const codes = [];
  const serve = createBrowserRuntime(async () => { created++; return async () => {
    if (++calls <= 3) throw new Error('sensitive request failure'); return Response.json({ recovered: true });
  }; }, { enabled: () => true, onError: code => codes.push(code) });
  for (let i = 0; i < 3; i++) assert.equal((await serve(request())).status, 503);
  assert.equal((await serve(request())).status, 200); assert.equal(created, 1);
  assert.deepEqual(codes, Array(3).fill('NAVYIX_BROWSER_REQUEST_FAILED'));
});
test('normal unauthorized/error responses are preserved, not treated as failed initialization', async () => {
  let count = 0;
  const serve = createBrowserRuntime(async () => { count++; return async () => new Response('denied', { status: 401, headers: { 'set-cookie': 'session=; Max-Age=0' } }); }, { enabled: () => true });
  const result = await serve(request());
  assert.equal(result.status, 401); assert.equal(result.headers.get('set-cookie'), 'session=; Max-Age=0');
  await serve(request()); assert.equal(count, 1);
});
test('request failures racing with successes retain the shared handler', async () => {
  const gate = deferred(); let initialized = 0;
  const serve = createBrowserRuntime(async () => { initialized++; return async req => {
    if (new URL(req.url).pathname === '/slow') { await gate.promise; throw new Error('late error'); }
    return new Response('ok');
  }; }, { enabled: () => true });
  const slow = serve(new Request('https://navyix.example/slow')); await tick();
  assert.equal((await serve(request())).status, 200); gate.resolve(); assert.equal((await slow).status, 503);
  assert.equal((await serve(request())).status, 200); assert.equal(initialized, 1);
});
test('disabling during initialization prevents request processing', async () => {
  let enabled = true, handled = 0; const gate = deferred();
  const serve = createBrowserRuntime(() => gate.promise, { enabled: () => enabled });
  const pending = serve(request()); await tick(); enabled = false;
  gate.resolve(async () => { handled++; return new Response('ok'); });
  assert.equal((await pending).status, 503); assert.equal(handled, 0);
});
test('disabled requests never discard an already allocated handler', async () => {
  let enabled = true, count = 0;
  const serve = createBrowserRuntime(async () => { count++; return async () => new Response('ok'); }, { enabled: () => enabled });
  await serve(request()); enabled = false; assert.equal((await serve(request())).status, 503);
  enabled = true; assert.equal((await serve(request())).status, 200); assert.equal(count, 1);
});
test('telemetry failure cannot escape the request boundary', async () => {
  const serve = createBrowserRuntime(async () => { throw new Error('sensitive'); }, { enabled: () => true, onError: () => { throw new Error('logger failed'); } });
  assert.equal((await serve(request())).status, 503);
});
test('invalid initializer result is rejected and does not get used as a handler', async () => {
  const codes = [];
  const serve = createBrowserRuntime(async () => ({}), { enabled: () => true, onError: c => codes.push(c) });
  assert.equal((await serve(request())).status, 503); assert.deepEqual(codes, ['NAVYIX_BROWSER_STARTUP_FAILED']);
});
test('invalid handler output is redacted without reinitializing', async () => {
  let count = 0;
  const serve = createBrowserRuntime(async () => { count++; return async () => ({ token: 'secret' }); }, { enabled: () => true });
  for (let i = 0; i < 2; i++) { const result = await serve(request()); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /secret/); }
  assert.equal(count, 1);
});
test('synchronous startup throws are handled with cooldown', async () => {
  let count = 0;
  const serve = createBrowserRuntime(() => { count++; throw new Error('sync'); }, { enabled: () => true });
  await serve(request()); await serve(request()); assert.equal(count, 1);
});
test('failure responses are non-cacheable and do not set cookies', async () => {
  const result = await createBrowserRuntime(async () => null)(request());
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('set-cookie'), null);
});
test('invalid runtime options fail at construction', () => {
  assert.throws(() => createBrowserRuntime(null));
  for (const retryAfterMs of [0, -1, 1.5, 60001, NaN, Infinity, '2000'])
    assert.throws(() => createBrowserRuntime(async () => {}, { retryAfterMs }));
  for (const name of ['enabled', 'onError', 'clock'])
    assert.throws(() => createBrowserRuntime(async () => {}, { [name]: null }));
});
