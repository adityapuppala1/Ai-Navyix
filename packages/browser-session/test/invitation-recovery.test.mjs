import test from 'node:test';
import assert from 'node:assert/strict';
import { InvitationClient } from '../src/invitation-client.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code = 'nvi1.' + Buffer.alloc(32, 7).toString('base64url');
const expiresAt = new Date(Date.now() + 86400000).toISOString();
const row = { id: id(2), email: 'recipient@example.test', role: 'VIEWER', status: 'pending', createdAt: new Date().toISOString(), expiresAt };
function fixture(custom) {
  const calls = []; let key = 20;
  const api = { authenticated: true, generation: 1, uuid: () => id(key++), request: async (path, init = {}) => {
    calls.push({ path, init: structuredClone(init) });
    if (custom) { const r = await custom(path, init); if (r !== undefined) return r; }
    if (path.endsWith('/preview')) return { orgId: id(1), organizationName: 'Synthetic organization', role: 'VIEWER', expiresAt, alreadyMember: false };
    if (path.endsWith('/accept')) return { orgId: id(1), organizationName: 'Synthetic organization', role: 'VIEWER', alreadyMember: false, requestId: init.key };
    if (path.endsWith('/revoke')) return { orgId: id(1), invitationId: id(2), status: 'revoked', requestId: init.key };
    if (init.method === 'POST') return { orgId: id(1), invitationId: id(2), email: init.body.email, role: init.body.role, status: 'pending', expiresAt, code, requestId: init.key };
    return { orgId: id(1), invitations: [row], next: null };
  } };
  return { api, client: new InvitationClient(api), calls };
}
const create = c => c.create({ email: 'recipient@example.test', role: 'VIEWER', hours: 24 });

test('creation without a successful current-session directory read cannot dispatch', async () => {
  const f = fixture(); f.client.orgId = id(1);
  assert.throws(() => create(f.client), e => e.code === 'STALE_CONTEXT'); assert.equal(f.calls.length, 0);
});
for (const operation of ['create', 'revoke', 'accept']) test(`${operation} cannot reuse a previous session's displayed context`, async () => {
  const f = fixture(); await f.client.list(id(1)); if (operation === 'accept') await f.client.inspect(code);
  const before = f.calls.length; f.api.generation++;
  assert.throws(() => operation === 'create' ? create(f.client) : operation === 'revoke' ? f.client.revoke(id(2)) : f.client.accept(), e => e.code === 'STALE_CONTEXT');
  assert.equal(f.calls.length, before); assert.equal(f.client.preview, null); assert.deepEqual(f.client.rows, []);
});
for (const change of ['session', 'signout', 'epoch']) test(`pending invitation retry is checked before dispatch after ${change}`, async () => {
  const f = fixture((p,o) => { if (o.method === 'POST') throw new Error('Lost response'); });
  await f.client.list(id(1)); await assert.rejects(create(f.client)); const count = f.calls.length;
  if (change === 'session') f.api.generation++; else if (change === 'signout') f.api.authenticated = false; else f.client.epoch++;
  await assert.rejects(f.client.retry(), e => e.code === 'STALE_CONTEXT'); assert.equal(f.calls.length, count); assert.equal(f.client.pending, null);
});
test('parallel retries share one pending invitation request', async () => {
  let release;
  const f = fixture((path,init) => init.method === 'POST' ? new Promise(resolve => { release = () => resolve({ orgId: id(1), invitationId: id(2), email: init.body.email, role: init.body.role, status: 'pending', expiresAt, code, requestId: init.key }); }) : undefined);
  await f.client.list(id(1)); const first = create(f.client); const a = f.client.retry(), b = f.client.retry();
  assert.equal(f.calls.filter(x => x.init.method === 'POST').length, 1);
  release(); const results = await Promise.all([first, a, b]); assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]); assert.equal(f.client.flight, null);
});
test('a new session may explicitly load a new directory after old context was refused', async () => {
  const f = fixture(); await f.client.list(id(1)); f.api.generation++; assert.throws(() => create(f.client));
  await f.client.list(id(1)); assert.equal((await create(f.client)).orgId, id(1));
});
test('failed directory reload invalidates creation context', async () => {
  let fail = false; const f = fixture(() => { if (fail) throw Object.assign(new Error('Denied'), { status: 404 }); });
  await f.client.list(id(1)); fail = true; await assert.rejects(f.client.list(id(1))); const count = f.calls.length;
  assert.throws(() => create(f.client), e => e.code === 'STALE_CONTEXT'); assert.equal(f.calls.length, count);
});
test('changing organizations clears an earlier recipient preview', async () => {
  const f = fixture((path,init) => !init.method && path.includes(id(3)) ? { orgId: id(3), invitations: [], next: null } : undefined);
  await f.client.list(id(1)); await f.client.inspect(code); await f.client.list(id(3));
  assert.equal(f.client.preview, null); assert.throws(() => f.client.accept(), e => e.code === 'PREVIEW_REQUIRED');
});
test('late invitation failure cannot clear a newer context request', async () => {
  const waits = []; const f = fixture((p,o) => o.method === 'POST' ? new Promise((resolve,reject) => waits.push({resolve,reject,o})) : undefined);
  await f.client.list(id(1)); const old = create(f.client).catch(e => e);
  f.api.generation++; f.client.reset(); await f.client.list(id(1)); const current = create(f.client); const pending = f.client.pending;
  waits[0].reject(Object.assign(new Error('Old conflict'), { status: 409 })); assert.equal((await old).code, 'STALE_CONTEXT'); assert.equal(f.client.pending, pending);
  waits[1].resolve({ orgId: id(1), invitationId: id(2), email: waits[1].o.body.email, role: 'VIEWER', status: 'pending', expiresAt, code, requestId: waits[1].o.key });
  await current; assert.equal(f.client.pending, null);
});
test('signed-out list and preview calls clear retained data before any request', async () => {
  for (const operation of ['list','inspect']) {
    const f = fixture(); await f.client.list(id(1)); await f.client.inspect(code); f.api.authenticated = false; const count = f.calls.length;
    await assert.rejects(operation === 'list' ? f.client.list(id(1)) : f.client.inspect(code), e => e.code === 'STALE_CONTEXT');
    assert.equal(f.calls.length, count); assert.deepEqual(f.client.rows, []); assert.equal(f.client.preview, null);
  }
});
test('the saved invitation payload and expected acknowledgement cannot be edited during uncertainty', async () => {
  const f = fixture((p,o) => { if (o.method === 'POST') throw new Error('Lost response'); }); await f.client.list(id(1)); await assert.rejects(create(f.client));
  assert.throws(() => { f.client.pending.body.email = 'other@example.test'; }, TypeError);
  assert.throws(() => { f.client.pending.expected.orgId = id(9); }, TypeError);
  await assert.rejects(f.client.retry()); assert.deepEqual(f.calls.at(-1), f.calls.at(-2));
});
test('invalid acknowledgement still retains the same invitation and retry identifier', async () => {
  let invalid = true; const f = fixture((p,o) => invalid && o.method === 'POST' ? { orgId: id(9), requestId: o.key } : undefined);
  await f.client.list(id(1)); await assert.rejects(create(f.client), e => e.code === 'INVALID_INVITATION_RESPONSE'); const original = f.client.pending;
  invalid = false; await f.client.retry(); assert.equal(f.calls.at(-1).init.key, original.key); assert.equal(f.client.pending, null);
});
