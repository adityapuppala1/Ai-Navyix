import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { InvitationService } from '../src/invitations.mjs';
import { PrismaInvitationRepository } from '../src/invitation-repository.mjs';
const strict=process.env.NAVYIX_REQUIRE_INTEGRATION==='1';
const live=process.env.NAVYIX_TEST_DB_CONFIRM==='disposable'&&process.env.NAVYIX_TEST_ADMIN_URL&&process.env.NAVYIX_TEST_DATABASE_URL;
const require=createRequire(new URL('../../../apps/api/package.json',import.meta.url));
test('live PostgreSQL invitation lifecycle, single-use membership and privilege boundaries',{
 skip:!live&&!strict?'Disposable PostgreSQL unavailable; invitation SQL NOT executed':false
},async t=>{
 assert.ok(live,'Use only a migrated disposable database.');
 const{PrismaClient}=require('@prisma/client');
 const admin=new PrismaClient({datasourceUrl:process.env.NAVYIX_TEST_ADMIN_URL}),db=new PrismaClient({datasourceUrl:process.env.NAVYIX_TEST_DATABASE_URL});
 const orgs=[randomUUID(),randomUUID()],owner=randomUUID(),recipient=randomUUID(),viewer=randomUUID(),suffix=randomUUID();
 const issuer='https://invite-'+suffix+'.example';
 const emails=new Map([[owner,`owner-${suffix}@example.test`],[recipient,`recipient-${suffix}@example.test`],[viewer,`viewer-${suffix}@example.test`]]);
 const principal=sub=>({issuer,subject:sub});
 const proof={verify:async p=>({...p,email:emails.get(p.subject)||`${p.subject}@example.test`})};
 const repo=new PrismaInvitationRepository(db),service=new InvitationService(repo,{key:randomBytes(32),identity:proof});
 const create=(email=emails.get(recipient),role='VIEWER',requestId=randomUUID())=>service.create(principal(owner),orgs[0],{email,role,hours:24},requestId);
 let first;
 try{
  await repo.assertRuntime();
  for(const id of [owner,viewer])await admin.user.create({data:{id,oidcIssuer:issuer,oidcSubject:id,email:emails.get(id)}});
  for(const id of orgs)await admin.organization.create({data:{id,name:'Invitation fixture',slug:id}});
  await admin.membership.create({data:{id:randomUUID(),orgId:orgs[0],userId:owner,role:'OWNER'}});
  await admin.membership.create({data:{id:randomUUID(),orgId:orgs[0],userId:viewer,role:'VIEWER'}});
  await t.test('owner can create with safe retry but viewer and foreign organization cannot',async()=>{
   const key=randomUUID();first=await create(undefined,undefined,key);assert.equal((await create(undefined,undefined,key)).code,first.code);
   await assert.rejects(service.create(principal(viewer),orgs[0],{email:'x@example.test',role:'VIEWER'},randomUUID()),e=>e.status===404);
   await assert.rejects(service.list(principal(owner),orgs[1]),e=>e.status===404);
  });
  await t.test('list never exposes token hashes or code',async()=>{
   const list=await service.list(principal(owner),orgs[0]);assert.equal(list.invitations.length,1);assert.ok(!JSON.stringify(list).includes(first.code));assert.ok(!JSON.stringify(list).includes('tokenHash'));
  });
  await t.test('wrong recipient cannot inspect or accept a valid code',async()=>{
   await assert.rejects(service.preview(principal(viewer),'test',{code:first.code},randomUUID()),e=>e.status===404);
  });
  await t.test('acceptance provisions only the verified identity and organization membership; receipt retry is single-use',async()=>{
   const preview=await service.preview(principal(recipient),'test',{code:first.code},randomUUID());assert.equal(preview.orgId,orgs[0]);
   const key=randomUUID(),result=await service.accept(principal(recipient),'test',{code:first.code},key);
   assert.equal(result.role,'VIEWER');assert.deepEqual(await service.accept(principal(recipient),'test',{code:first.code},key),result);
   await assert.rejects(service.accept(principal(recipient),'test',{code:first.code},randomUUID()),e=>e.status===404);
   const user=await admin.user.findUnique({where:{oidcIssuer_oidcSubject:{oidcIssuer:issuer,oidcSubject:recipient}}});
   assert.ok(user);assert.equal(await admin.membership.count({where:{orgId:orgs[0],userId:user.id}}),1);
   assert.equal(await admin.projectMembership.count({where:{userId:user.id}}),0);
  });
  await t.test('revoked invitation cannot confer new access',async()=>{
   const x=await create('revoked@example.test');await service.revoke(principal(owner),orgs[0],x.invitationId,randomUUID());
   emails.set('revoked','revoked@example.test');await assert.rejects(service.accept(principal('revoked'),'test',{code:x.code},randomUUID()),e=>e.status===404);
  });
  await t.test('expired invitation is not usable',async()=>{
   const x=await create('expired@example.test');
   // Shift both timestamps to preserve the real expiry constraint.
   await admin.$executeRawUnsafe("UPDATE navyix_invitations.invitation SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1::uuid",x.invitationId);
   emails.set('expired','expired@example.test');await assert.rejects(service.preview(principal('expired'),'test',{code:x.code},randomUUID()),e=>e.status===404);
  });
  await t.test('inactive existing membership is not restored by an invitation',async()=>{
   const x=await create(emails.get(viewer));await admin.membership.update({where:{orgId_userId:{orgId:orgs[0],userId:viewer}},data:{active:false}});
   await assert.rejects(service.accept(principal(viewer),'test',{code:x.code},randomUUID()),e=>e.status===404);
  });
  await t.test('identity collision never links by email',async()=>{
   const x=await create('collision@example.test');const other=randomUUID();
   await admin.user.create({data:{id:other,oidcIssuer:issuer,oidcSubject:other,email:'collision@example.test'}});
   emails.set('collision','collision@example.test');await assert.rejects(service.accept(principal('collision'),'test',{code:x.code},randomUUID()),e=>e.status===404);
  });
  await t.test('parallel acceptance creates at most one membership and consumes the invitation once',async()=>{
   const sub=randomUUID(),email=`concurrent-${suffix}@example.test`;emails.set(sub,email);const x=await create(email);
   const results=await Promise.allSettled([service.accept(principal(sub),'test',{code:x.code},randomUUID()),service.accept(principal(sub),'test',{code:x.code},randomUUID())]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.ok(results.filter(r=>r.status==='rejected').every(r=>[404,409].includes(r.reason.status)));
   const user=await admin.user.findUnique({where:{oidcIssuer_oidcSubject:{oidcIssuer:issuer,oidcSubject:sub}}});
   assert.equal(await admin.membership.count({where:{orgId:orgs[0],userId:user.id}}),1);
  });
  await t.test('suspended organizations do not accept pending invitations',async()=>{
   emails.set('suspended','suspended@example.test');const x=await create('suspended@example.test');
   await admin.organization.update({where:{id:orgs[0]},data:{active:false}});
   await assert.rejects(service.accept(principal('suspended'),'test',{code:x.code},randomUUID()),e=>e.status===404);
   await admin.organization.update({where:{id:orgs[0]},data:{active:true}});
  });
  await t.test('demoting inviter blocks pending invitation acceptance',async()=>{
   const x=await create('demoted@example.test');emails.set('demoted','demoted@example.test');
   await admin.membership.update({where:{orgId_userId:{orgId:orgs[0],userId:owner}},data:{role:'VIEWER'}});
   await assert.rejects(service.accept(principal('demoted'),'test',{code:x.code},randomUUID()),e=>e.status===404);
  });
  await t.test('runtime cannot directly inspect invitations, mutate memberships or assume the function-owner role',async()=>{
   await assert.rejects(db.$queryRawUnsafe('SELECT * FROM navyix_invitations.invitation'));
   await assert.rejects(db.$executeRawUnsafe('UPDATE public."Membership" SET role=\'OWNER\''));
   await assert.rejects(db.$executeRawUnsafe('SET ROLE navyix_invitation_executor'));
  });
 }finally{
  try{
   await admin.$executeRawUnsafe('DELETE FROM navyix_invitations.request WHERE org_id IN ($1::uuid,$2::uuid)',...orgs);
   await admin.$executeRawUnsafe('DELETE FROM navyix_invitations.invitation WHERE org_id IN ($1::uuid,$2::uuid)',...orgs);
   await admin.auditEvent.deleteMany({where:{orgId:{in:orgs}}});await admin.membership.deleteMany({where:{orgId:{in:orgs}}});
   await admin.organization.deleteMany({where:{id:{in:orgs}}});await admin.user.deleteMany({where:{oidcIssuer:issuer}});
  }finally{await db.$disconnect();await admin.$disconnect();}
 }
});
