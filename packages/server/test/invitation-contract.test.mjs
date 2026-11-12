import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const sql=await readFile(new URL('../../../apps/api/prisma/migrations/202611120007_organization_invitations/migration.sql',import.meta.url),'utf8');
const main=await readFile(new URL('../../../apps/api/src/main.ts',import.meta.url),'utf8');
test('invitation schema grants runtime function execution, never membership/table mutation',()=>{
 assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA navyix_invitations FROM PUBLIC,navyix_runtime/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION navyix_invitations.execute\(text,uuid,jsonb,uuid\) TO navyix_runtime/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]+TO navyix_runtime/);
 assert.match(sql,/NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
 assert.match(sql,/SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on/);
});
test('all private tables force RLS; no plaintext token or existing-membership update is defined',()=>{
 assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g)||[]).length,2);
 assert.doesNotMatch(sql,/token_plaintext|raw_token|UPDATE public\."Membership"/);
 assert.match(sql,/token_hash text NOT NULL UNIQUE/);assert.doesNotMatch(sql,/INSERT INTO public\."ProjectMembership"/);
});
test('SQL rechecks actor and inviter authority, recipient identity and expiry, then records audit and receipt',()=>{
 assert.match(sql,/member.role NOT IN \('OWNER','ADMIN'\)/);assert.match(sql,/m.role IN \('OWNER','ADMIN'\) FOR SHARE OF u,m/);
 assert.match(sql,/item.email<>verified_email/);assert.match(sql,/item.expires_at<=clock_timestamp\(\)/);
 assert.match(sql,/member.id IS NOT NULL AND NOT member.active/);assert.match(sql,/lower\(email\)=lower\(verified_email\)/);
 assert.ok(sql.indexOf('INSERT INTO public."AuditEvent"')<sql.indexOf('INSERT INTO navyix_invitations.request'));
});
test('invitation middleware is mounted before organization-directory middleware',()=>{
 assert.ok(main.indexOf('runtime.createInvitationHandler')<main.indexOf('runtime.createOrganizationDirectoryHandler'));
 assert.match(main,/invitationsEnabled === 'true' && enabled !== 'true'/);
});
