import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';

/** Mounted at /v1/me, using the same verified-token authenticator as project APIs. */
export function createOrganizationDirectoryHandler({ service, authenticate, onError = () => {} }) {
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Request-Id', requestId);
    const send = (status, value) => { if (!res.destroyed && !res.writableEnded) { res.statusCode = status; res.end(JSON.stringify(value)); } };
    try {
      const authHeaders = (req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(n => n.toLowerCase() === 'authorization');
      if (authHeaders.length > 1) throw new ApiError(401, 'UNAUTHENTICATED', 'One access token is required.');
      const principal = await authenticate(req.headers.authorization);
      const url = new URL(req.originalUrl || req.url, 'http://navyix.internal');
      if (url.pathname !== '/v1/me/organizations') throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.'); }
      const options = {};
      for (const [key, value] of url.searchParams) {
        if (!['after','limit'].includes(key) || Object.hasOwn(options, key)) throw new ApiError(400, 'INVALID_QUERY', 'Unexpected or repeated query parameter.');
        if (key === 'limit') {
          if (!/^[1-9]\d?$/.test(value) || +value > 50) throw new ApiError(400, 'INVALID_QUERY', 'Limit must be 1–50.');
          options.limit = Number(value);
        } else options.after = value;
      }
      // Do not read bodies on this read-only endpoint. Reject bodies instead of leaving a stream pending.
      if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))
        throw new ApiError(400, 'INVALID_BODY', 'This endpoint does not accept a body.');
      return send(200, await service.list(principal, options));
    } catch (error) {
      req.resume();
      if (error instanceof ApiError) return send(error.status, { error: { code: error.code, message: error.message, requestId } });
      try { onError({ requestId, code: 'DIRECTORY_UNAVAILABLE' }); } catch { /* redacted telemetry only */ }
      return send(503, { error: { code: 'DIRECTORY_UNAVAILABLE', message: 'Organization list is unavailable. Retry later.', requestId } });
    }
  };
}
