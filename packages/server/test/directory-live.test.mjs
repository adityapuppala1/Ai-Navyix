import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { OrganizationDirectoryService, PrismaOrganizationDirectory } from '../src/organization-directory.mjs';
const required=process.env.NAVYIX_REQUIRE_INTEGRATION==='1';
const configured=process.env.NAVYIX_TEST_DB_CONFIRM==='disposable' && Boolean(process.env.NAVYIX_TEST_DATABASE_URL && process.env.NAVYIX_TEST_ADMIN_URL);
const require=createRequire(new URL('../../../apps/api/package.json',import.meta.url));
test('live organization directory: own active memberships and transaction-local discovery',{
 skip:!configured&&!required?'Disposable migrated PostgreSQL unavailable; directory RLS NOT executed':false
},async t=>{
 assert.ok(configured,'Configure only an explicitly disposable, migrated database.');
 const{PrismaClient}=require('@prisma/client');
 const url=new URL(process.env.NAVYIX_TEST_DATABASE_URL);url.searchParams.set('connection_limit','1');
 const admin=new PrismaClient({datasourceUrl:process.env.NAVYIX_TEST_ADMIN_URL});
 const db=new PrismaClient({datasourceUrl:url.href});
 const users=[randomUUID(),randomUUID()],orgs=Array.from({length:3},()=>randomUUID()).sort();
 const issuer='https://directory.integration.example';
 const identity=i=>({issuer,subject:users[i]});
 try{
  const repo=new PrismaOrganizationDirectory(db);await repo.assertRuntime();const service=new OrganizationDirectoryService(repo);
  for(let i=0;i<users.length;i++)await admin.user.create({data:{id:users[i],oidcIssuer:issuer,oidcSubject:users[i],email:users[i]+'@example.test'}});
  for(const org of orgs)await admin.organization.create({data:{id:org,name:'Directory test '+org,slug:org}});
  for(const [org,user,role] of [[orgs[0],users[0],'OWNER'],[orgs[2],users[0],'VIEWER'],[orgs[1],users[1],'OWNER']])
   await admin.membership.create({data:{id:randomUUID(),orgId:org,userId:user,role}});
  await t.test('identity A sees its two organizations but not B',async()=>assert.deepEqual((await service.list(identity(0))).organizations.map(o=>o.id),[orgs[0],orgs[2]]));
  await t.test('same pool switches identity without leaking organization context',async()=>{
   for(let i=0;i<3;i++){assert.deepEqual((await service.list(identity(1))).organizations.map(o=>o.id),[orgs[1]]);assert.deepEqual((await service.list(identity(0))).organizations.map(o=>o.id),[orgs[0],orgs[2]]);}
  });
  await t.test('real UUID pagination returns each own membership once',async()=>{const a=await service.list(identity(0),{limit:1});assert.equal(a.next,orgs[0]);const b=await service.list(identity(0),{limit:1,after:a.next});assert.deepEqual(b.organizations.map(o=>o.id),[orgs[2]]);assert.equal(b.next,null);});
  await t.test('unknown verified identity has no memberships',async()=>assert.deepEqual((await service.list({issuer,subject:randomUUID()})).organizations,[]));
  await t.test('directory and org GUCs do not survive the transaction',async()=>{
   const[r]=await db.$queryRawUnsafe(`SELECT current_setting('navyix.personal_directory',true) AS mode,current_setting('navyix.org_id',true) AS org`);assert.ok(!r.mode);assert.ok(!r.org);
   assert.equal((await db.$queryRawUnsafe('SELECT id FROM public."Organization"')).length,0);
  });
  await t.test('discovery mode still exposes no project data and cannot write',async()=>{
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$queryRawUnsafe(`SELECT set_config('navyix.issuer',$1,true),set_config('navyix.subject',$2,true),set_config('navyix.org_id','',true),set_config('navyix.personal_directory','true',true)`,issuer,users[0]);
    assert.equal((await tx.$queryRawUnsafe('SELECT * FROM public."WorkflowState"')).length,0);
   });
   await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await tx.$executeRawUnsafe('UPDATE public."WorkflowState" SET revision=revision');}));
  });
  await t.test('revoked organization membership disappears on the next request',async()=>{
   await admin.membership.update({where:{orgId_userId:{orgId:orgs[2],userId:users[0]}},data:{active:false}});
   assert.deepEqual((await service.list(identity(0))).organizations.map(o=>o.id),[orgs[0]]);
  });
  await t.test('suspended organization is excluded',async()=>{await admin.organization.update({where:{id:orgs[0]},data:{active:false}});assert.equal((await service.list(identity(0))).organizations.length,0);});
  await t.test('disabled identity sees no organizations',async()=>{await admin.user.update({where:{id:users[1]},data:{active:false}});assert.equal((await service.list(identity(1))).organizations.length,0);});
 }finally{
  try{await admin.membership.deleteMany({where:{orgId:{in:orgs},userId:{in:users}}});await admin.organization.deleteMany({where:{id:{in:orgs}}});await admin.user.deleteMany({where:{id:{in:users}}});}
  finally{await db.$disconnect();await admin.$disconnect();}
 }
});
