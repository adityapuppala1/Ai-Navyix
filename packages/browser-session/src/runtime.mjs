/** One process-local browser handler/pool. Request failures never invalidate a healthy resource. */
export function createBrowserRuntime(initialize, {
  enabled = () => false,
  onError = () => {},
  clock = Date.now,
  retryAfterMs = 2000
} = {}) {
  if (typeof initialize !== 'function' || typeof enabled !== 'function' ||
      typeof onError !== 'function' || typeof clock !== 'function' ||
      !Number.isSafeInteger(retryAfterMs) || retryAfterMs < 1 || retryAfterMs > 60000) {
    throw new TypeError('Invalid browser runtime configuration.');
  }
  let initialization = null;
  let retryAt = 0;
  const log = code => { try { onError(code); } catch { /* Telemetry cannot break the boundary. */ } };
  const response = (code, message) => new Response(JSON.stringify({ error: { code, message } }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff' }
  });
  const disabled = () => response('BROWSER_DISABLED', 'Server sign-in is not enabled.');
  const unavailable = () => response('BROWSER_UNAVAILABLE', 'Server sign-in is not configured or is unavailable.');
  function handler() {
    if (initialization) return initialization;
    if (clock() < retryAt) return null;
    const attempt = Promise.resolve().then(initialize).then(value => {
      if (typeof value !== 'function') throw new TypeError('Expected a request handler.');
      return value;
    }).catch(error => {
      if (initialization === attempt) {
        initialization = null;
        retryAt = clock() + retryAfterMs;
        log('NAVYIX_BROWSER_STARTUP_FAILED');
      }
      throw error;
    });
    initialization = attempt;
    return attempt;
  }
  return async request => {
    let ready;
    try {
      if (enabled() !== true) return disabled();
      ready = await handler();
      if (!ready) return unavailable();
      // A disabled feature must not handle a request that waited for initialization.
      if (enabled() !== true) return disabled();
    } catch { return unavailable(); }
    try {
      const result = await ready(request);
      if (!(result instanceof Response)) throw new TypeError('Expected a Response.');
      return result;
    } catch {
      // Do not discard initialization: that would orphan the live pool and create another.
      log('NAVYIX_BROWSER_REQUEST_FAILED');
      return response('BROWSER_REQUEST_FAILED', 'The request could not be completed. Try again later.');
    }
  };
}
