import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once, getEventListeners } from 'node:events';
import { limitedText, discardBody, BodyReadError } from '../src/body.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const code = expected => e => e instanceof BodyReadError && e.code === expected;
function chunks(values, options = {}) {
  let cancelCount = 0;
  const body = new ReadableStream({
    start(c) { for (const value of values) c.enqueue(value); if (!options.stall) c.close(); },
    cancel() { cancelCount++; return options.cancel?.(); }
  });
  return { message: new Response(body, { headers: options.headers }), cancelled: () => cancelCount };
}
const utf8 = text => new TextEncoder().encode(text);

test('complete valid UTF-8 is preserved at the exact byte boundary', async () => {
  const text = '{"name":"தமிழ் · Navyix 🚀"}', bytes = utf8(text);
  assert.equal(await limitedText(new Response(bytes), bytes.length), text);
});
test('UTF-8 codepoints split across chunks decode correctly', async () => {
  const bytes = utf8('தமிழ்🚀'); const f = chunks([...bytes].map(byte => Uint8Array.of(byte)));
  assert.equal(await limitedText(f.message, bytes.length), 'தமிழ்🚀'); assert.equal(f.message.body.locked, false);
});
test('empty bodies are permitted and resources are unlocked', async () => {
  assert.equal(await limitedText(new Response(null), 1), '');
  const response = new Response(''); assert.equal(await limitedText(response, 1), ''); assert.equal(response.body.locked, false);
});
test('count actual bytes even when Content-Length understates the body', async () => {
  const f = chunks([utf8('hello'), utf8('world')], { stall: true, headers: { 'content-length': '1' } });
  await assert.rejects(limitedText(f.message, 9), code('BODY_TOO_LARGE')); assert.equal(f.cancelled(), 1); assert.equal(f.message.body.locked, false);
});
test('declared oversized body is rejected and cancelled before reading', async () => {
  const f = chunks([], { stall: true, headers: { 'content-length': '1001' } });
  await assert.rejects(limitedText(f.message, 1000), code('BODY_TOO_LARGE')); assert.equal(f.cancelled(), 1);
});
for (const length of ['-1', '1e2', 'NaN', '2, 2', '1.5']) test(`invalid declared length ${length} is rejected`, async () => {
  const f = chunks([], { stall: true, headers: { 'content-length': length } });
  await assert.rejects(limitedText(f.message, 1000), code('BODY_LENGTH')); assert.equal(f.cancelled(), 1);
});
test('unsafe integer declared length cannot bypass the byte limit', async () => {
  await assert.rejects(limitedText(new Response('x', { headers: { 'content-length': '9007199254740993' } }), 100), code('BODY_TOO_LARGE'));
});
test('malformed UTF-8 is rejected rather than silently repaired', async () => {
  await assert.rejects(limitedText(new Response(Uint8Array.of(0x22, 0xc3, 0x28, 0x22)), 100), code('BODY_ENCODING'));
});
test('truncated UTF-8 is rejected at end of stream', async () => {
  await assert.rejects(limitedText(new Response(Uint8Array.of(0xe2, 0x82)), 100), code('BODY_ENCODING'));
});
test('a body stalled before the first chunk reaches the absolute deadline', async () => {
  const f = chunks([], { stall: true });
  await assert.rejects(limitedText(f.message, 100, { timeoutMs: 20 }), code('BODY_TIMEOUT'));
  assert.equal(f.cancelled(), 1); assert.equal(f.message.body.locked, false);
});
test('cancellation cleanup itself cannot prevent the deadline from settling', async () => {
  const f = chunks([], { stall: true, cancel: () => new Promise(() => {}) });
  await assert.rejects(limitedText(f.message, 100, { timeoutMs: 20 }), code('BODY_TIMEOUT')); assert.equal(f.cancelled(), 1);
});
test('continuous drip-feed does not reset the total deadline', async () => {
  let timer, cancelled = false;
  const response = new Response(new ReadableStream({
    start(c) { timer = setInterval(() => c.enqueue(utf8('x')), 5); },
    cancel() { cancelled = true; clearInterval(timer); }
  }));
  try { await assert.rejects(limitedText(response, 10000, { timeoutMs: 35 }), code('BODY_TIMEOUT')); assert.equal(cancelled, true); }
  finally { clearInterval(timer); }
});
test('pre-aborted Request is rejected without waiting for its stream', async () => {
  const signal = AbortSignal.abort(new Error('sensitive abort reason'));
  const req = new Request('https://navyix.test', { method: 'POST', body: new ReadableStream({}), duplex: 'half', signal });
  await assert.rejects(limitedText(req, 100), code('BODY_ABORTED')); assert.equal(req.body.locked, false);
});
test('aborting an in-progress Request stops its pending body read', async () => {
  const abort = new AbortController(); let cancelled = 0;
  const req = new Request('https://navyix.test', { method: 'POST', signal: abort.signal, duplex: 'half',
    body: new ReadableStream({ start(c) { c.enqueue(utf8('{')); }, cancel() { cancelled++; } }) });
  const pending = limitedText(req, 100); await tick(); abort.abort('not exposed');
  await assert.rejects(pending, code('BODY_ABORTED')); assert.equal(cancelled, 1);
});
test('explicit response signal cancels a stalled upstream read', async () => {
  const f = chunks([], { stall: true }), abort = new AbortController();
  const pending = limitedText(f.message, 100, { signal: abort.signal }); await tick(); abort.abort();
  await assert.rejects(pending, code('BODY_ABORTED')); assert.equal(f.cancelled(), 1);
});
test('abort listeners are removed after success and failure', async () => {
  const abort = new AbortController(); const before = getEventListeners(abort.signal, 'abort').length;
  await limitedText(new Response('ok'), 100, { signal: abort.signal });
  assert.equal(getEventListeners(abort.signal, 'abort').length, before);
  const f = chunks([], { stall: true });
  await assert.rejects(limitedText(f.message, 100, { signal: abort.signal, timeoutMs: 10 }));
  assert.equal(getEventListeners(abort.signal, 'abort').length, before);
});
test('immediately produced empty chunks are bounded', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } }));
  await assert.rejects(limitedText(response, 100, { maxChunks: 16 }), code('BODY_CHUNKS')); assert.equal(cancelled, true);
});
test('non-byte chunks are rejected and the stream is cancelled', async () => {
  const f = chunks(['not bytes'], { stall: true });
  await assert.rejects(limitedText(f.message, 100), code('BODY_STREAM')); assert.equal(f.cancelled(), 1);
});
test('underlying stream error text is not propagated', async () => {
  const response = new Response(new ReadableStream({ start(c) { c.error(new Error('password=hidden')); } }));
  await assert.rejects(limitedText(response, 100), e => code('BODY_STREAM')(e) && !e.message.includes('hidden'));
});
test('an already locked body is not stolen from its reader', async () => {
  const response = new Response('hello'), reader = response.body.getReader();
  await assert.rejects(limitedText(response, 100), code('BODY_STREAM'));
  assert.equal(response.body.locked, true); await reader.cancel(); reader.releaseLock();
});
test('invalid bounds and signals cannot disable limits', async () => {
  for (const limit of [0, -1, NaN, Infinity, 16_000_001, '100']) await assert.rejects(limitedText(new Response(''), limit), TypeError);
  for (const value of [0, -1, NaN, Infinity, 60_001, 0.5]) await assert.rejects(limitedText(new Response(''), 100, { timeoutMs: value }), TypeError);
  for (const value of [0, -1, 16385, '2']) await assert.rejects(limitedText(new Response(''), 100, { maxChunks: value }), TypeError);
  await assert.rejects(limitedText(new Response(''), 100, { signal: {} }), TypeError);
});
test('discarding an unconsumed response does not await a stalled cancel hook', async () => {
  const f = chunks([], { stall: true, cancel: () => new Promise(() => {}) });
  assert.equal(discardBody(f.message), undefined); await tick(); assert.equal(f.cancelled(), 1);
});
test('failed cancellation hooks do not produce unhandled rejection', async () => {
  const f = chunks([], { stall: true, cancel: () => Promise.reject(new Error('private cancel reason')) });
  discardBody(f.message); await tick(); assert.equal(f.cancelled(), 1);
});
test('real loopback HTTP response that never ends is bounded and disconnected', async () => {
  let closed; const disconnected = new Promise(resolve => { closed = resolve; });
  const server = createServer((_req, res) => { res.on('close', closed); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(limitedText(response, 100, { timeoutMs: 40 }), code('BODY_TIMEOUT'));
    await Promise.race([disconnected, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Connection not closed')), 1000); timer.unref(); })]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
