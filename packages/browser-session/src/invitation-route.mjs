import { reject } from './config.mjs';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export function invitationProxyTarget(url, method) {
  const admin = new RegExp(`^/api/browser/api/orgs/(${UUID})/invitations(?:/(${UUID})/revoke)?$`, 'i').exec(url.pathname);
  const recipient = /^\/api\/browser\/api\/me\/invitations\/(preview|accept)$/.test(url.pathname);
  if (!admin && !recipient) return null;
  if ((recipient || admin?.[2]) ? method !== 'POST' : !['GET', 'POST'].includes(method)) reject(405, 'METHOD_NOT_ALLOWED', 'Unsupported invitation operation.');
  if (method === 'POST' && url.search) reject(400, 'INVALID_QUERY', 'Invitation data must not be put in URLs.');
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !['after','limit'].includes(key) ||
        (key === 'after' && !new RegExp(`^${UUID}$`, 'i').test(value)) ||
        (key === 'limit' && !/^(?:[1-9]|1\d|20)$/.test(value))) reject(400, 'INVALID_QUERY', 'Invalid invitation page.');
    seen.add(key);
  }
  return '/v1/' + url.pathname.slice('/api/browser/api/'.length) + url.search;
}
