import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';
const ID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
async function body(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) throw new ApiError(415, 'INVALID_MEDIA', 'Use uncompressed JSON.');
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new ApiError(413, 'TOO_LARGE', 'Invitation requests are limited to 4 KB.');
  const value = await new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    const done = (error) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', fail);
      if (error) { req.resume(); reject(error); } else resolve(Buffer.concat(chunks));
    };
    const fail = () => done(new ApiError(400, 'INVALID_BODY', 'Request was interrupted.'));
    const data = chunk => { if ((size += chunk.length) > 4096) done(new ApiError(413, 'TOO_LARGE', 'Invitation requests are limited to 4 KB.')); else chunks.push(chunk); };
    const end = () => done(); const timer = setTimeout(() => done(new ApiError(408, 'BODY_TIMEOUT', 'Invitation upload timed out.')), 5000);
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', fail);
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw new ApiError(400, 'INVALID_BODY', 'Use valid UTF-8 JSON.'); }
}
/** Mounted before ordinary /v1 handlers; unrelated routes pass through unchanged. */
export function createInvitationHandler({ service, authenticate, onError = () => {} }) {
  return async (req, res, next = () => {}) => {
    const url = new URL(req.originalUrl || req.url, 'http://navyix.internal');
    const admin = new RegExp(`^/v1/orgs/(${ID})/invitations(?:/(${ID})/revoke)?$`, 'i').exec(url.pathname);
    const recipient = /^\/v1\/me\/invitations\/(preview|accept)$/.exec(url.pathname);
    if (!admin && !recipient) return next();
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Request-Id', requestId);
    const send = (status, value) => { if (!res.destroyed && !res.writableEnded) { res.statusCode = status; res.end(JSON.stringify(value)); } };
    try {
      for (const name of ['authorization', 'idempotency-key']) {
        if ((req.rawHeaders || []).filter((value, i) => i % 2 === 0 && value.toLowerCase() === name).length > 1) throw new ApiError(400, 'DUPLICATE_HEADER', 'Use one authentication and request identifier header.');
      }
      const principal = await authenticate(req.headers.authorization);
      const listing = admin && !admin[2] && req.method === 'GET';
      if (!listing && req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use the supported GET or POST operation.');
      if (listing) {
        const options = {};
        for (const [key, value] of url.searchParams) {
          if (!['after', 'limit'].includes(key) || Object.hasOwn(options, key)) throw new ApiError(400, 'INVALID_QUERY', 'Unexpected or repeated query parameter.');
          if (key === 'limit' && !/^(?:[1-9]|1\d|20)$/.test(value)) throw new ApiError(400, 'INVALID_QUERY', 'Limit must be 1–20.');
          options[key] = key === 'limit' ? Number(value) : value;
        }
        return send(200, await service.list(principal, admin[1], options));
      }
      if (url.search) throw new ApiError(400, 'INVALID_QUERY', 'Do not put invitation data in the URL.');
      const value = await body(req), key = req.headers['idempotency-key'];
      if (recipient) return send(200, await service[recipient[1]](principal, req.headers.authorization, value, key));
      if (admin[2]) {
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) throw new ApiError(400, 'INVALID_INPUT', 'Revocation takes an empty JSON object.');
        return send(200, await service.revoke(principal, admin[1], admin[2], key));
      }
      return send(201, await service.create(principal, admin[1], value, key));
    } catch (error) {
      req.resume();
      if (error instanceof ApiError) return send(error.status, { error: { code: error.code, message: error.message, requestId } });
      try { onError({ code: 'INVITATION_SERVICE_ERROR', requestId }); } catch { /* no raw error/recipient/token logging */ }
      return send(503, { error: { code: 'INVITATION_SERVICE_ERROR', message: 'Invitation operation could not be confirmed. Retry the same request.', requestId } });
    }
  };
}
