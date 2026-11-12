import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as rawRequest } from 'node:http';
import { once } from 'node:events';
import { createInvitationHandler } from '../src/invitation-http.mjs';
import { ApiError } from '../src/errors.mjs';
const org='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222';
async function fixture(run) {
 const calls=[];const service=Object.fromEntries(['list','create','revoke','preview','accept'].map(name=>[name,async(...args)=>{calls.push({name,args});return {ok:true};}]));
 const h=createInvitationHandler({service,authenticate:async header=>{if(header!=='Bearer signed')throw new ApiError(401,'UNAUTHENTICATED','Sign in');return{issuer:'https://issuer.test',subject:'caller'};}});
 const server=createServer((req,res)=>h(req,res,()=>{res.statusCode=404;res.end('unrelated');}));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const send=(path,method='GET',value,headers={})=>fetch(origin+path,{method,headers:{authorization:'Bearer signed','content-type':'application/json','idempotency-key':key,...headers},...(value!==undefined?{body:typeof value==='string'?value:JSON.stringify(value)}:{})});
 try{await run({send,calls,service,origin});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('real HTTP routes create/list/revoke/preview/accept to the correct service without URL codes',()=>fixture(async({send,calls})=>{
 assert.equal((await send(`/v1/orgs/${org}/invitations`,'POST',{email:'a@example.com',role:'VIEWER'})).status,201);
 assert.equal((await send(`/v1/orgs/${org}/invitations?limit=20`)).status,200);
 assert.equal((await send(`/v1/orgs/${org}/invitations/${key}/revoke`,'POST',{})).status,200);
 for(const mode of ['preview','accept'])assert.equal((await send('/v1/me/invitations/'+mode,'POST',{code:'nvi1.test'})).status,200);
 assert.deepEqual(calls.map(x=>x.name),['create','list','revoke','preview','accept']);assert.equal(calls.at(-1).args[1],'Bearer signed');
}));
test('unrelated routes continue through the existing application',()=>fixture(async({send,calls})=>{assert.equal((await send('/v1/me/organizations')).status,404);assert.equal(calls.length,0);}));
test('authentication errors prevent service execution',()=>fixture(async({send,calls})=>{assert.equal((await send('/v1/me/invitations/accept','POST',{}, {authorization:'bad'})).status,401);assert.equal(calls.length,0);}));
test('query tokens and unexpected fields in revocation are rejected',()=>fixture(async({send,calls})=>{
 assert.equal((await send('/v1/me/invitations/accept?code=secret','POST',{})).status,400);
 assert.equal((await send(`/v1/orgs/${org}/invitations/${key}/revoke`,'POST',{role:'OWNER'})).status,400);assert.equal(calls.length,0);
}));
test('read-only methods cannot accept membership or revoke invitations',()=>fixture(async({send,calls})=>{for(const path of ['/v1/me/invitations/accept',`/v1/orgs/${org}/invitations/${key}/revoke`])assert.equal((await send(path)).status,405);assert.equal(calls.length,0);}));
test('malformed and oversized JSON never reaches the invitation service',()=>fixture(async({send,calls})=>{
 const path='/v1/me/invitations/accept';assert.equal((await send(path,'POST','{oops')).status,400);assert.equal((await send(path,'POST','x'.repeat(4097))).status,413);
 assert.equal((await send(path,'POST','{}',{'content-type':'text/plain'})).status,415);assert.equal(calls.length,0);
}));
test('unexpected database errors are redacted and preserve uncertainty',()=>fixture(async({send,service})=>{
 service.accept=async()=>{throw new Error('postgres://user:secret@db');};const r=await send('/v1/me/invitations/accept','POST',{});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/postgres|secret/);
}));
