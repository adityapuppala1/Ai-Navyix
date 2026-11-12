import { reject } from './config.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Returns only a fixed API path. Identity still comes from the existing HttpOnly session proxy. */
export function organizationProxyTarget(url, method) {
  if (url.pathname !== '/api/browser/api/me/organizations') return null;
  if (method !== 'GET') reject(405, 'METHOD_NOT_ALLOWED', 'Use GET for organization selection.');
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !['after','limit'].includes(key)))
    reject(400, 'INVALID_QUERY', 'Unexpected or repeated query parameter.');
  for (const [key, value] of url.searchParams) {
    if ((key === 'after' && !UUID.test(value)) || (key === 'limit' && (!/^[1-9]\d?$/.test(value) || +value > 50)))
      reject(400, 'INVALID_QUERY', 'Invalid organization page.');
  }
  return '/v1/me/organizations' + url.search;
}
