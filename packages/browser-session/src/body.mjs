/** Server-only bounded UTF-8 reader for token responses, API responses and browser uploads. */
export class BodyReadError extends Error {
  constructor(code, message) { super(message); this.name = 'BodyReadError'; this.code = code; }
}
const problem = code => new BodyReadError(code, {
  BODY_TOO_LARGE: 'Response too large.',
  BODY_TIMEOUT: 'Body read deadline exceeded.',
  BODY_ABORTED: 'Body read was aborted.',
  BODY_LENGTH: 'Invalid content length.',
  BODY_CHUNKS: 'Body chunk limit exceeded.',
  BODY_ENCODING: 'Body is not valid UTF-8.',
  BODY_STREAM: 'Body could not be read.'
}[code]);

/** A total deadline, not an idle timeout. Caller-supplied content never configures these bounds. */
export async function limitedText(message, maxBytes, {
  signal = message?.signal,
  timeoutMs = 10_000,
  maxChunks = 8192
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16_000_000 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > 16384 ||
      (signal !== undefined && !(signal instanceof AbortSignal))) {
    throw new TypeError('Invalid bounded body reader configuration.');
  }
  let reader, timer, stopError, cancelStarted = false, complete = false;
  const deadline = performance.now() + timeoutMs;
  const chunks = []; let bytes = 0, count = 0;
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  // A pre-aborted request may reject before the first read/race is installed.
  void stopped.catch(() => {});
  const cancel = () => {
    if (cancelStarted || !reader) return;
    cancelStarted = true;
    // An underlying cancel hook can itself stall. Never await it on an error path.
    try { void reader.cancel().catch(() => {}); } catch { /* Best-effort cleanup. */ }
  };
  const stop = code => {
    if (stopError) return;
    stopError = problem(code); rejectStopped(stopError); cancel();
  };
  const aborted = () => stop('BODY_ABORTED');
  const check = () => {
    if (signal?.aborted) stop('BODY_ABORTED');
    if (!stopError && performance.now() >= deadline) stop('BODY_TIMEOUT');
    if (stopError) throw stopError;
  };
  try {
    reader = message.body?.getReader();
    const length = message.headers.get('content-length');
    if (length !== null) {
      if (!/^\d+$/.test(length)) throw problem('BODY_LENGTH');
      if (!Number.isSafeInteger(Number(length)) || Number(length) > maxBytes) throw problem('BODY_TOO_LARGE');
    }
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => stop('BODY_TIMEOUT'), timeoutMs);
    check();
    if (!reader) { complete = true; return ''; }
    for (;;) {
      check();
      const { value, done } = await Promise.race([reader.read(), stopped]);
      check();
      if (done) break;
      // Counts empty chunks too: an immediate empty-chunk loop must terminate.
      if (++count > maxChunks) throw problem('BODY_CHUNKS');
      if (!(value instanceof Uint8Array)) throw problem('BODY_STREAM');
      bytes += value.byteLength;
      if (bytes > maxBytes) throw problem('BODY_TOO_LARGE');
      if (value.byteLength) chunks.push(Buffer.from(value));
    }
    let result;
    try { result = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); }
    catch { throw problem('BODY_ENCODING'); }
    check(); complete = true; return result;
  } catch (error) {
    if (error instanceof BodyReadError) throw error;
    throw problem('BODY_STREAM');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', aborted);
    if (!complete) cancel();
    try { reader?.releaseLock(); } catch { /* Never replace the original error. */ }
  }
}

/** Release an unconsumed error response without waiting for a potentially stalled cancellation hook. */
export function discardBody(message) {
  try { void message.body?.cancel().catch(() => {}); } catch { /* No raw network/body errors escape. */ }
}
