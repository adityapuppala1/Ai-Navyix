/** Classify by documented codes, never error-message text or constraint contents. */
const POSTGRES_CONFLICTS = new Set(['40001', '40P01', '23505']);
export function isTransactionConflict(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.code === 'P2034' || error.code === 'P2002' || POSTGRES_CONFLICTS.has(error.code)) return true;
  // Prisma wraps raw-query database errors in P2010 and exposes the SQLSTATE in meta.code.
  return error.code === 'P2010' && POSTGRES_CONFLICTS.has(error.meta?.code);
}
