import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TeamService, PrismaTeamRepository } from '../src/team.mjs';
import { ApiError } from '../src/errors.mjs';
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user='cccccccc-cccc-4ccc-8ccc-cccccccccccc', key='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const principal={issuer:'https://identity.example',subject:'server-verified-subject'};
const input={userId:user,role:'REVIEWER',active:true,expectedRevision:0};
function fixture(failure) {
  const calls=[];
  const svc=new TeamService({async transaction(ctx,fn){calls.push({ctx});if(failure)throw failure;return fn({
    directory:async (...args)=>{calls.push({directory:args});return {members:[]};},
    change:async(...args)=>{calls.push({change:args});return {accepted:true};}
  });}});
  return {svc,calls};
}
test('directory validates pagination and passes trusted identity separately',async()=>{const{svc,calls}=fixture();await svc.list(principal,org,project,{limit:50,after:user});assert.deepEqual(calls[0].ctx,{principal,orgId:org,projectId:project});assert.deepEqual(calls[1].directory,[user,50]);});
test('change canonicalizes UUIDs and derives a stable operation-bound hash',async()=>{const{svc,calls}=fixture();await svc.change(principal,org.toUpperCase(),project,{...input,userId:user.toUpperCase()},key);await svc.change(principal,org,project,{expectedRevision:0,active:true,role:'REVIEWER',userId:user},key);assert.deepEqual(calls[1].change,calls[3].change);assert.match(calls[1].change[2],/^[a-f0-9]{64}$/);});
test('changed access content changes the request hash',async()=>{const{svc,calls}=fixture();await svc.change(principal,org,project,input,key);await svc.change(principal,org,project,{...input,role:'VIEWER'},key);assert.notEqual(calls[1].change[2],calls[3].change[2]);});
for(const [name,value]of [['missing identity',null],['empty subject',{...principal,subject:''}],['nonstring subject',{...principal,subject:{}}]])test(name+' denied before repository',async()=>{const{svc,calls}=fixture();await assert.rejects(svc.list(value,org,project),e=>e.status===401);assert.equal(calls.length,0);});
for(const limit of [0,-1,51,1.1,'20',NaN,Infinity])test(`invalid limit ${limit}`,async()=>{const{svc}=fixture();await assert.rejects(svc.list(principal,org,project,{limit}),e=>e.status===400);});
for(const [name,change]of [
 ['owner grant',{role:'OWNER'}],['unknown role',{role:'ROOT'}],['case mismatch',{role:'reviewer'}],['missing role',{role:undefined}],
 ['string active',{active:'true'}],['missing active',{active:undefined}],['negative revision',{expectedRevision:-1}],['float revision',{expectedRevision:1.1}],
 ['string revision',{expectedRevision:'1'}],['missing revision',{expectedRevision:undefined}],['overflow revision',{expectedRevision:2147483647}],['extra actor',{actorId:user}],['extra organization',{orgId:org}],['invalid user',{userId:'no'}]
])test(name+' rejected without storage call',async()=>{const{svc,calls}=fixture();await assert.rejects(svc.change(principal,org,project,{...input,...change},key),e=>e.status===400);assert.equal(calls.length,0);});
for(const [i,payload] of [null,[],Object.assign(Object.create(null),input)].entries())test('only plain command objects '+i,async()=>{const{svc}=fixture();await assert.rejects(svc.change(principal,org,project,payload,key),e=>e.status===400);});
for(const [code,status]of [['42501',404],['22023',400],['40001',409],['23505',409],['40P01',409]]){
 test(`direct SQLSTATE ${code} has safe response`,async()=>{const{svc}=fixture({code,message:'secret sql password'});await assert.rejects(svc.change(principal,org,project,input,key),e=>e.status===status&&!e.message.includes('secret'));});
 test(`wrapped SQLSTATE ${code} has safe response`,async()=>{const{svc}=fixture({code:'P2010',meta:{code},message:'secret sql password'});await assert.rejects(svc.change(principal,org,project,input,key),e=>e.status===status&&!e.message.includes('secret'));});
}
test('unknown database failures are not falsely called access denials',async()=>{const err={code:'42601'};const{svc}=fixture(err);await assert.rejects(svc.list(principal,org,project),e=>e===err);});
test('typed application errors are preserved',async()=>{const err=new ApiError(413,'BIG','Too large');const{svc}=fixture(err);await assert.rejects(svc.list(principal,org,project),e=>e===err);});
test('repository binds every caller value and transaction-local context',async()=>{
 const calls=[];const prisma={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');return fn({$queryRawUnsafe:async(sql,...args)=>{calls.push({sql,args});return[{data:{ok:true}}];}});}};
 const repo=new PrismaTeamRepository(prisma);await repo.transaction({principal,orgId:org,projectId:project},async tx=>{await tx.directory(user,20);await tx.change(input,key,'f'.repeat(64));});
 assert.deepEqual(calls[0].args,[principal.issuer,principal.subject,org]);assert.equal((calls[0].sql.match(/,true\)/g)||[]).length,3);
 assert.deepEqual(calls[1].args,[project,user,20]);assert.deepEqual(calls[2].args,[project,user,'REVIEWER',true,0,key,'f'.repeat(64)]);
 assert.ok(calls.every(c=>!c.sql.includes(user)&&!c.sql.includes(principal.subject)));
});
for(const field of ['rolsuper','rolbypassrls','rolcanlogin','inherited'])test('startup rejects '+field,async()=>{const repo=new PrismaTeamRepository({$queryRawUnsafe:async()=>[{rolsuper:false,rolbypassrls:false,rolcanlogin:false,inherited:false,functions:2,[field]:true}]});await assert.rejects(repo.assertRuntime());});
test('startup rejects missing team migration',async()=>{const repo=new PrismaTeamRepository({$queryRawUnsafe:async()=>[]});await assert.rejects(repo.assertRuntime());});
test('startup accepts a restricted function owner descriptor',async()=>{const repo=new PrismaTeamRepository({$queryRawUnsafe:async()=>[{rolsuper:false,rolbypassrls:false,rolcanlogin:false,inherited:false,functions:2}]});await repo.assertRuntime();});
const sql=readFileSync(new URL('../../../apps/api/prisma/migrations/202611120003_project_team/migration.sql',import.meta.url),'utf8');
test('migration structure keeps definer ownership narrow and public execution revoked (not live SQL)',()=>{assert.match(sql,/NOLOGIN NOINHERIT NOSUPERUSER/);assert.match(sql,/NOBYPASSRLS/);assert.equal((sql.match(/SECURITY DEFINER SET search_path=pg_catalog SET row_security=on/g)||[]).length,2);assert.match(sql,/REVOKE ALL ON FUNCTION navyix_team.change_member/);assert.doesNotMatch(sql,/GRANT navyix_team_executor TO/);assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;/);});
test('migration contains revision, owner protection, role ceiling, and atomic audit controls (not live SQL)',()=>{for(const part of ['OLD."accessRevision" + 1',"membership.role='OWNER'",'target_user=actor',"org_role='VIEWER'",'IF prior."requestHash"<>request_hash','INSERT INTO public."AuditEvent"','INSERT INTO public."WorkflowCommand"'])assert.ok(sql.includes(part),part);});
