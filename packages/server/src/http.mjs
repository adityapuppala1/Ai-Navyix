import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';
const MAX_BYTES = 1_000_000;
async function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || ''))
    throw new ApiError(415, 'CONTENT_TYPE', 'Use application/json.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
    throw new ApiError(415, 'CONTENT_ENCODING', 'Compressed requests are not accepted.');
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new ApiError(413, 'TOO_LARGE', 'Request exceeds 1 MB.');
  const chunks = []; let size = 0;
  // Explicit listener cleanup avoids async-iterator destruction before a JSON error response.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new ApiError(408, 'TIMEOUT', 'Request body timeout.')), 10000);
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const done = failure => { cleanup(); if (failure) { req.resume(); reject(failure); } else resolve(); };
    const data = chunk => { size += chunk.length; if (size > MAX_BYTES) done(new ApiError(413, 'TOO_LARGE', 'Request exceeds 1 MB.')); else chunks.push(chunk); };
    const end = () => done();
    const error = () => done(new ApiError(400, 'BODY_ERROR', 'Request body could not be read.'));
    const aborted = () => done(new ApiError(400, 'BODY_ERROR', 'Request was aborted.'));
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON.'); }
}
function query(url, allowed) {
  const value = {};
  for (const [key, item] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(value, key)) throw new ApiError(400, 'INVALID_QUERY', 'Unexpected or duplicate query parameter.');
    value[key] = item;
  }
  return value;
}
/** Mounted within Nest/Express with bodyParser:false; no separate production server. */
export function createHttpHandler({ service, authenticate, onError = () => {}, teamService = null, githubService = null }) {
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Request-Id', requestId);
    const send = (status, body) => { if (!res.destroyed && !res.writableEnded) { res.statusCode = status; res.end(JSON.stringify(body)); } };
    try {
      const authorizationCount = (req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(name => name.toLowerCase() === 'authorization').length;
      if (authorizationCount > 1) throw new ApiError(401, 'UNAUTHENTICATED', 'One access token is required.');
      const principal = await authenticate(req.headers.authorization);
      const url = new URL(req.originalUrl || req.url, 'http://navyix.internal');
      const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
      if (parts[0] !== 'v1' || parts[1] !== 'orgs' || parts[3] !== 'projects' || parts.length < 4)
        throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
      const orgId = parts[2], projectId = parts[4], tail = parts[5];
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST'); throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      if (githubService && req.method === 'GET' && parts.length === 6 && tail === 'github-evidence') {
        return send(200, await githubService.inspect(principal, orgId, projectId, query(url, ['buildId', 'runId', 'attempt'])));
      }
      if (teamService && req.method === 'GET' && parts.length === 6 && tail === 'team') {
        const q = query(url, ['after', 'limit']);
        if (q.limit !== undefined && !/^[1-9]\d?$/.test(q.limit)) throw new ApiError(400, 'INVALID_QUERY', 'Limit must be 1–50.');
        return send(200, await teamService.list(principal, orgId, projectId, { after: q.after, limit: q.limit === undefined ? 20 : Number(q.limit) }));
      }
      if (teamService && req.method === 'POST' && parts.length === 7 && tail === 'team' && parts[6] === 'commands') {
        query(url, []);
        return send(200, await teamService.change(principal, orgId, projectId, await readJson(req), req.headers['idempotency-key']));
      }
      if (req.method === 'GET' && parts.length === 4) {
        const q = query(url, ['after', 'limit']);
        if (q.limit !== undefined && !/^[1-9]\d?$/.test(q.limit)) throw new ApiError(400, 'INVALID_QUERY', 'Limit must be 1–50.');
        return send(200, await service.list(principal, orgId, { after: q.after, limit: q.limit === undefined ? 20 : Number(q.limit) }));
      }
      if (req.method === 'POST' && parts.length === 4) {
        query(url, []);
        return send(201, await service.create(principal, orgId, await readJson(req), req.headers['idempotency-key']));
      }
      if (req.method === 'GET' && parts.length === 5) {
        query(url, []); return send(200, await service.get(principal, orgId, projectId));
      }
      if (req.method === 'POST' && parts.length === 6 && tail === 'commands') {
        query(url, []); return send(200, await service.command(principal, orgId, projectId, await readJson(req), req.headers['idempotency-key']));
      }
      if (req.method === 'GET' && parts.length === 6 && tail === 'readiness')
        return send(200, await service.assess(principal, orgId, projectId, query(url, ['stage', 'buildId', 'environment'])));
      if (req.method === 'GET' && parts.length === 6 && tail === 'report-template') {
        const q = query(url, ['buildId']); return send(200, await service.template(principal, orgId, projectId, q.buildId));
      }
      if (req.method === 'GET' && parts.length === 7 && tail === 'assessments') {
        query(url, []); return send(200, await service.assessment(principal, orgId, projectId, parts[6]));
      }
      throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
    } catch (error) {
      if (error instanceof URIError) return send(400, { error: { code: 'INVALID_PATH', message: 'Invalid URL encoding.', requestId } });
      if (error instanceof ApiError) return send(error.status, { error: { code: error.code, message: error.message, requestId } });
      // Deliberately do not pass raw errors (SQL/credentials) to generic telemetry.
      try { onError({ requestId, code: 'INTERNAL_ERROR' }); } catch { /* telemetry must not break error handling */ }
      return send(500, { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', requestId } });
    }
  };
}
