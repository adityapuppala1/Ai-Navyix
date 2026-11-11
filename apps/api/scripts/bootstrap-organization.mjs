// Explicit administrative operation only. Never called by application startup or CI.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
if (process.env.CONFIRM_ORG_BOOTSTRAP !== 'yes' || !process.env.MIGRATION_DATABASE_URL || !process.argv[2]) {
  console.error('Requires CONFIRM_ORG_BOOTSTRAP=yes, MIGRATION_DATABASE_URL, and a local JSON input path. See docs/SERVER_WORKFLOW.md.');
  process.exit(1);
}
const db = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
try {
  const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
  for (const key of ['name', 'slug', 'issuer', 'subject', 'email']) {
    if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 255) throw new Error('Invalid bootstrap input.');
  }
  if (Object.keys(data).some(key => !['name', 'slug', 'issuer', 'subject', 'email'].includes(key))) throw new Error('Unexpected bootstrap field.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug) || !/^https:\/\//.test(data.issuer)) throw new Error('Invalid slug or issuer.');
  const orgId = randomUUID();
  await db.$transaction(async tx => {
    // A pre-existing identity is found only by the complete issuer+subject pair.
    const old = await tx.user.findUnique({ where: { oidcIssuer_oidcSubject: { oidcIssuer: data.issuer, oidcSubject: data.subject } } });
    if (old && !old.active) throw new Error('Inactive identity cannot be bootstrapped.');
    const user = old || await tx.user.create({ data: { id: randomUUID(), oidcIssuer: data.issuer, oidcSubject: data.subject, email: data.email } });
    await tx.organization.create({ data: { id: orgId, name: data.name, slug: data.slug } });
    await tx.membership.create({ data: { id: randomUUID(), orgId, userId: user.id, role: 'OWNER' } });
    await tx.auditEvent.create({ data: { id: randomUUID(), orgId, actorId: user.id, action: 'organization.bootstrap', entityType: 'Organization', entityId: orgId, metadata: { administrativeOperation: true } } });
  });
  console.log(JSON.stringify({ organizationId: orgId, message: 'Created organization and owner membership. No password or token was created.' }));
} catch {
  console.error('Bootstrap failed; no partial organization was committed. Check validated input, identity uniqueness, and administrative permissions.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
