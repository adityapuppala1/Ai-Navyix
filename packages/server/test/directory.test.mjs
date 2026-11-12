import test from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationDirectoryService, PrismaOrganizationDirectory } from '../src/organization-directory.mjs';
import { readFile } from 'node:fs/promises';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const principal = { issuer: 'https://issuer.example', subject: 'alice' };
const row = (n=1) => ({ id: id(n), name: 'Organization '+n, role: 'VIEWER' });
const service = (rows=[]) => new OrganizationDirectoryService({list:async()=>rows});

test('empty membership list is valid and does not bootstrap an organization', async()=>assert.deepEqual(await service().list(principal),{organizations:[],next:null}));
test('directory outputs only organization identity, label and own role',async()=>assert.deepEqual(await service([{...row(),email:'private',oidcSubject:'secret',memberCount:999}]).list(principal),{organizations:[row()],next:null}));
test('caller identity strips all role and organization claims before storage lookup',async()=>{
 let args;const s=new OrganizationDirectoryService({list:async(...a)=>{args=a;return[];}});
 await s.list({...principal,role:'OWNER',orgId:id(99),email:'spoof'});assert.deepEqual(args,[principal,null,21]);
});
test('pagination asks for one extra record and emits the last displayed cursor',async()=>{
 const result=await service([row(1),row(2),row(3)]).list(principal,{limit:2});assert.deepEqual(result,{organizations:[row(1),row(2)],next:id(2)});
});
test('upper-case UUID input is normalized and bound, not interpolated',async()=>{
 let args;await new OrganizationDirectoryService({list:async(...a)=>{args=a;return[];}}).list(principal,{after:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',limit:1});
 assert.equal(args[1],'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(args[2],2);
});
for(const p of [null,{}, {issuer:'x'}, {subject:'x'}, {issuer:'',subject:'x'},{issuer:'x',subject:4}])
 test('invalid principal '+JSON.stringify(p),async()=>await assert.rejects(service().list(p),e=>e.status===401));
for(const limit of [0,51,-1,1.1,'20',null,Infinity])
 test('invalid page limit '+String(limit),async()=>await assert.rejects(service().list(principal,{limit}),e=>e.status===400));
for(const options of [{userId:id(1)},{orgId:id(2)},{role:'OWNER'},{after:''},{after:'../../other'},null,[]])
 test('rejects caller-supplied identity/scope '+JSON.stringify(options),async()=>await assert.rejects(service().list(principal,options),e=>e.status===400));
for(const rows of [[row(2),row(1)],[row(1),row(1)],[{...row(),role:'ROOT'}],[{...row(),name:''}],[{...row(),id:'bad'}],null])
 test('rejects malformed repository result '+JSON.stringify(rows),async()=>await assert.rejects(service(rows).list(principal),/directory result/));
test('cursor cannot repeat an already displayed row',async()=>await assert.rejects(service([row(1)]).list(principal,{after:id(1)}),/directory result/));
test('unexpected repository errors remain errors, not an empty list',async()=>await assert.rejects(new OrganizationDirectoryService({list:async()=>{throw new Error('unavailable');}}).list(principal),/unavailable/));
test('repository uses read-only transaction-local identity, blank org and bound query values',async()=>{
 const calls=[];let options;
 const db={$executeRawUnsafe:async(...a)=>calls.push(a),$queryRawUnsafe:async(...a)=>{calls.push(a);return[];}};
 const repo=new PrismaOrganizationDirectory({$transaction:async(fn,o)=>{options=o;return fn(db);}});
 const malicious={issuer:"https://issuer.example/'--",subject:"x'; DELETE FROM User;--"};
 await repo.list(malicious,id(5),21);
 assert.equal(calls[0][0],'SET TRANSACTION READ ONLY');
 assert.match(calls[1][0],/set_config\('navyix.org_id','',true\)/);
 assert.match(calls[1][0],/personal_directory','true',true/);
 assert.deepEqual(calls[1].slice(1),[malicious.issuer,malicious.subject]);
 assert.deepEqual(calls[2].slice(1),[malicious.issuer,malicious.subject,id(5),21]);
 assert.ok(!calls[2][0].includes(malicious.subject));assert.equal(options.timeout,5000);
 assert.match(calls[2][0],/u.active AND m.active AND o.active/);
});
for(const state of [null,{safe:false,nonowner:true,policies:2},{safe:true,nonowner:false,policies:2},{safe:true,nonowner:true,policies:1}])
 test('unsafe runtime/missing migration rejects startup '+JSON.stringify(state),async()=>await assert.rejects(new PrismaOrganizationDirectory({$queryRawUnsafe:async()=>[state]}).assertRuntime(),/Restricted/));
test('restricted runtime with directory policies accepts startup contract',async()=>await new PrismaOrganizationDirectory({$queryRawUnsafe:async()=>[{safe:true,nonowner:true,policies:2}]}).assertRuntime());
const migration=await readFile(new URL('../../../apps/api/prisma/migrations/202611120006_organization_directory/migration.sql',import.meta.url),'utf8');
test('migration adds only own-membership discovery SELECT policies',()=>{
 assert.equal((migration.match(/CREATE POLICY/g)||[]).length,2);assert.equal((migration.match(/FOR SELECT TO navyix_runtime/g)||[]).length,2);
 assert.equal((migration.match(/COALESCE\(current_setting\('navyix.org_id',true\),''\) = ''/g)||[]).length,2);
 assert.match(migration,/"userId" = public.navyix_actor_id\(\)/);assert.match(migration,/m."userId"=public.navyix_actor_id\(\) AND m.active/);
 assert.doesNotMatch(migration.replace(/^--.*$/gm,''),/\b(GRANT|REVOKE|SECURITY DEFINER|INSERT|UPDATE|DELETE|DROP|DISABLE)\b/);
});
