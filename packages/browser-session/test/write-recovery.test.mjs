import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspace } from '../src/client.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nextTick = () => new Promise(resolve => setImmediate(resolve));
function fixture(custom) {
  const calls = []; let key = 100;
  const api = new BrowserWorkspace({ uuid: () => id(key++), fetcher: async (path, init) => {
    const call = { path, method: init.method, headers: { ...init.headers }, body: init.body };
    calls.push(call);
    if (custom) { const result = await custom(call, api); if (result !== undefined) return result; }
    const input = init.body === undefined ? undefined : JSON.parse(init.body);
    if (init.method === 'POST') return Response.json({ projectId: path.endsWith('/commands') ? id(2) : id(3),
      revision: path.endsWith('/commands') ? input.expectedRevision + 1 : 1, requestId: init.headers['idempotency-key'] });
    return Response.json({});
  } });
  api.authenticated = true; api.csrf = 'synthetic'; api.generation = 7; api.orgId = id(1); api.project = { id: id(2), revision: 9 };
  return { api, calls };
}
const save = api => api.command('requirement.add', { title: 'Synthetic requirement', acceptance: 'Expected result' });

test('valid command acknowledgement confirms exact project/revision/request only', async () => {
  const { api, calls } = fixture(); const ack = await save(api);
  assert.deepEqual(ack, { projectId: id(2), revision: 10, requestId: id(100) });
  assert.equal(api.pending, null); assert.equal(calls[0].headers['x-navyix-csrf'], 'synthetic');
});
test('creation acknowledges a server-assigned UUID at revision one', async () => {
  const { api } = fixture(); assert.deepEqual(await api.create({ name: 'New' }), { projectId: id(3), revision: 1, requestId: id(100) });
});
for (const [name, override] of [
  ['wrong project', { projectId: id(55) }], ['wrong request', { requestId: id(56) }], ['wrong revision', { revision: 11 }],
  ['missing revision', { revision: undefined }], ['string revision', { revision: '10' }],
  ['invalid project ID', { projectId: 'not-a-project' }], ['missing request', { requestId: undefined }]
]) test(`unmatched acknowledgement (${name}) preserves the original request for retry`, async () => {
  let wrong = true;
  const { api, calls } = fixture(call => wrong ? Response.json({ projectId: id(2), revision: 10, requestId: call.headers['idempotency-key'], ...override }) : undefined);
  await assert.rejects(save(api), e => e.code === 'INVALID_SAVE_ACK'); const pending = api.pending;
  assert.ok(pending); wrong = false; await api.retry();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]); assert.equal(api.pending, null);
});
for (const value of [null, [], {}, 'success']) test('invalid acknowledgement shape stays unconfirmed: '+JSON.stringify(value), async () => {
  const { api } = fixture(() => Response.json(value)); await assert.rejects(save(api), e => e.code === 'INVALID_SAVE_ACK'); assert.ok(api.pending);
});
test('creation cannot accept a later revision', async () => {
  const { api } = fixture(call => Response.json({ projectId: id(3), revision: 2, requestId: call.headers['idempotency-key'] }));
  await assert.rejects(api.create({ name: 'New' }), e => e.code === 'INVALID_SAVE_ACK'); assert.ok(api.pending);
});
for (const [name, change] of [
  ['new session', api => { api.generation++; }], ['signed out', api => { api.authenticated = false; }],
  ['different organization', api => { api.orgId = id(9); }], ['different project', api => { api.project = { id: id(8), revision: 9 }; }]
]) test(`retry refuses dispatch after ${name}`, async () => {
  const { api, calls } = fixture(() => { throw new Error('Lost acknowledgement'); });
  await assert.rejects(save(api)); const before = calls.length; change(api);
  await assert.rejects(api.retry(), e => e.code === 'STALE_CONTEXT'); assert.equal(calls.length, before); assert.equal(api.pending, null);
});
test('simultaneous retry clicks share one in-flight request', async () => {
  let release; const { api, calls } = fixture(call => new Promise(resolve => { release = () => resolve(Response.json({ projectId: id(2), revision: 10, requestId: call.headers['idempotency-key'] })); }));
  const first = save(api); const second = api.retry(); const third = api.retry();
  assert.equal(calls.length, 1); release(); const results = await Promise.all([first, second, third]);
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]); assert.equal(api.pending, null); assert.equal(api.writeFlight, null);
});
for (const status of [408, 429, 500, 502, 503]) test(`HTTP ${status} keeps the original save`, async () => {
  const { api } = fixture(() => Response.json({ error: { code: 'RETRY' } }, { status })); await assert.rejects(save(api)); assert.ok(api.pending);
});
for (const status of [400, 403, 404, 409, 413, 415]) test(`definite HTTP ${status} permits correction without retaining an uncertain save`, async () => {
  const { api } = fixture(() => Response.json({ error: { code: 'DENIED' } }, { status })); await assert.rejects(save(api)); assert.equal(api.pending, null);
});
test('a stale successful response cannot clear a newer session save', async () => {
  const waiting = []; const { api } = fixture(call => new Promise(resolve => waiting.push({ call, resolve })));
  const old = save(api).catch(e => e); await nextTick();
  api.generation++; api.clear(); api.authenticated = true; api.orgId = id(1); api.project = { id: id(2), revision: 9 };
  const fresh = save(api); const pending = api.pending;
  waiting[0].resolve(Response.json({ projectId: id(2), revision: 10, requestId: waiting[0].call.headers['idempotency-key'] }));
  assert.equal((await old).code, 'STALE_CONTEXT'); assert.equal(api.pending, pending);
  waiting[1].resolve(Response.json({ projectId: id(2), revision: 10, requestId: waiting[1].call.headers['idempotency-key'] }));
  await fresh; assert.equal(api.pending, null);
});
test('payload is an immutable JSON snapshot and cannot change between retries', async () => {
  const { api, calls } = fixture(() => { throw new Error('Network'); });
  const input = { report: { results: [{ status: 'failed' }] } };
  await assert.rejects(api.command('results.import', input)); input.report.results[0].status = 'passed';
  assert.throws(() => { api.pending.body.input.report.results[0].status = 'passed'; }, TypeError);
  await assert.rejects(api.retry()); assert.equal(calls[0].body, calls[1].body); assert.match(calls[1].body, /failed/);
});
test('unserializable input is rejected before retaining a request or sending it', async () => {
  const { api, calls } = fixture(); const input = {}; input.self = input;
  await assert.rejects(api.command('test.add', input), e => e.code === 'INVALID_SAVE_BODY'); assert.equal(calls.length, 0); assert.equal(api.pending, null);
});
test('a new unauthenticated save cannot reach transport', async () => {
  const { api, calls } = fixture(); api.authenticated = false;
  await assert.rejects(save(api), e => e.code === 'SIGN_IN_REQUIRED'); assert.equal(calls.length, 0);
});
test('unknown paths cannot use the workflow save acknowledgement contract', async () => {
  const { api, calls } = fixture(); await assert.rejects(api.save('api/me/other', {}), e => e.code === 'INVALID_SAVE_TARGET'); assert.equal(calls.length, 0);
});
test('a saved receipt followed by a read failure stays saved, never retried as a new command', async () => {
  const { api } = fixture(call => call.method === 'GET' ? Response.json({ error: { message: 'Temporary outage' } }, { status: 503 }) : undefined);
  const ack = await save(api); await assert.rejects(api.afterSave(ack), e => e.code === 'SAVED_REFRESH_FAILED'); assert.equal(api.pending, null);
});
