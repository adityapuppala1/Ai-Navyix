import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PrismaWorkflowRepository } from '../src/repository.mjs';
import { A, OWNER } from './support/memory.mjs';
function fakeDatabase(handler=()=>[]) {
  const calls=[];let options;
  const db={$queryRawUnsafe:async(sql,...values)=>{calls.push({sql,values});return handler(sql,values);},$executeRawUnsafe:async(sql,...values)=>{calls.push({sql,values});return 1;}};
  return {calls,get options(){return options;},prisma:{$queryRawUnsafe:db.$queryRawUnsafe,$transaction:async(fn,opts)=>{options=opts;return fn(db);}}};
}
test('repository sets transaction-local issuer, subject, org before data access',async()=>{const f=fakeDatabase(),r=new PrismaWorkflowRepository(f.prisma);await r.transaction({principal:OWNER,orgId:A},tx=>tx.actor());assert.match(f.calls[0].sql,/set_config\('navyix.issuer',\$1,true\)/);assert.deepEqual(f.calls[0].values,[OWNER.issuer,OWNER.subject,A]);assert.equal(f.options.isolationLevel,'Serializable');assert.match(f.calls[1].sql,/FOR SHARE OF u,m,o/);});
test('hostile subject is passed as data, not SQL syntax',async()=>{const subject="' OR true --",f=fakeDatabase(),r=new PrismaWorkflowRepository(f.prisma);await r.transaction({principal:{...OWNER,subject},orgId:A},tx=>tx.actor());assert.ok(f.calls.every(c=>!c.sql.includes(subject)));assert.equal(f.calls[1].values[1],subject);});
test('revision update binds expected value and fails when no matching row exists',async()=>{const f=fakeDatabase(),r=new PrismaWorkflowRepository(f.prisma);await assert.rejects(r.transaction({principal:OWNER,orgId:A},tx=>tx.saveProject({id:A,revision:2},1)),e=>e.status===409);assert.match(f.calls.at(-1).sql,/revision=\$5::int/);assert.equal(f.calls.at(-1).values[4],1);});
test('audit insert does not need read access or save user payload',async()=>{const f=fakeDatabase(),r=new PrismaWorkflowRepository(f.prisma);await r.transaction({principal:OWNER,orgId:A},tx=>tx.audit({id:A,actorId:A,projectId:A,action:'requirement.add',requestId:A,revision:2,requestHash:'a'.repeat(64),at:new Date().toISOString()}));assert.doesNotMatch(f.calls.at(-1).sql,/RETURNING/);assert.equal(JSON.parse(f.calls.at(-1).values[5]).revision,2);});
const role={rolsuper:false,rolbypassrls:false,owner:false,member:true,security:'on'};
for(const [key,value] of [['rolsuper',true],['rolbypassrls',true],['owner',true],['member',false],['security','off']])test(`runtime startup rejects ${key}=${value}`,async()=>{const f=fakeDatabase(()=>[{...role,[key]:value}]);await assert.rejects(new PrismaWorkflowRepository(f.prisma).assertRuntime());});
test('runtime startup rejects missing migration',async()=>{const f=fakeDatabase(sql=>sql.includes('pg_roles')?[role]:[{tables:0,protected:false}]);await assert.rejects(new PrismaWorkflowRepository(f.prisma).assertRuntime(),/migration/);});
test('runtime startup accepts restricted role and migrated table contract',async()=>{const f=fakeDatabase(sql=>sql.includes('pg_roles')?[role]:[{tables:9,protected:true}]);await new PrismaWorkflowRepository(f.prisma).assertRuntime();});
const migration=await readFile(new URL('../../../apps/api/prisma/migrations/202611110001_server_workflow/migration.sql',import.meta.url),'utf8');
test('every migration table enables and forces RLS',()=>{const tables=[...migration.matchAll(/CREATE TABLE "(\w+)"/g)].map(m=>m[1]);assert.equal(tables.length,16);for(const table of tables){assert.ok(migration.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));assert.ok(migration.includes(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));}});
test('locking policies permit row locks but explicitly deny identity/membership updates',()=>{for(const table of ['User','Organization','Membership','ProjectMembership']){assert.match(migration,new RegExp(`CREATE POLICY "${table}_update"[^;]+WITH CHECK \\(false\\)`));}});
test('snapshot and audit have no runtime UPDATE DELETE TRUNCATE grants',()=>{const statements=migration.split(';').filter(s=>/GRANT (?:UPDATE|DELETE|TRUNCATE)/.test(s));for(const s of statements)assert.doesNotMatch(s,/"WorkflowSnapshot"|"WorkflowCommand"|"AuditEvent"/);});
test('composite membership foreign key prevents cross-organization project membership',()=>assert.match(migration,/FOREIGN KEY \("orgId","userId"\) REFERENCES "Membership" \("orgId","userId"\)/));
test('initial migration does not drop or reset existing data',()=>assert.doesNotMatch(migration.replace(/^--.*$/gm,''),/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)|\bTRUNCATE\b/));
