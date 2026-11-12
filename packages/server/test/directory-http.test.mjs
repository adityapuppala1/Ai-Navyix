import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createOrganizationDirectoryHandler } from '../src/organization-directory-http.mjs';
import { OrganizationDirectoryService } from '../src/organization-directory.mjs';
import { ApiError } from '../src/errors.mjs';
const id='11111111-1111-4111-8111-111111111111';
async function fixture(run,{fail=false}={}){
 const calls=[],logs=[];const service=new OrganizationDirectoryService({list:async(...a)=>{calls.push(a);if(fail)throw new Error('postgres://secret:password@host/db');return[{id,name:'Example',role:'VIEWER'}];}});
 const server=createServer(createOrganizationDirectoryHandler({service,authenticate:async header=>{if(header!=='Bearer synthetic')throw new ApiError(401,'UNAUTHENTICATED','Token required');return{issuer:'https://example.test',subject:'alice'};},onError:e=>logs.push(e)}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const request=(path='/v1/me/organizations',options={})=>fetch(`http://127.0.0.1:${server.address().port}`+path,{headers:{authorization:'Bearer synthetic'},...options});
 try{await run({request,calls,logs});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('real HTTP handler lists current identity organizations without cache',()=>fixture(async({request,calls})=>{
 const r=await request();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(await r.json(),{organizations:[{id,name:'Example',role:'VIEWER'}],next:null});assert.equal(calls[0][0].subject,'alice');
}));
test('unsigned caller rejected before storage access',()=>fixture(async({request,calls})=>{assert.equal((await request(undefined,{headers:{}})).status,401);assert.equal(calls.length,0);}));
for(const q of ['userId=other','orgId=other','role=OWNER','limit=20&limit=1','after=x','limit=51','limit=0'])test('HTTP rejects '+q,()=>fixture(async({request,calls})=>{assert.equal((await request('/v1/me/organizations?'+q)).status,400);assert.equal(calls.length,0);}));
for(const method of ['POST','PUT','DELETE'])test('HTTP is read-only '+method,()=>fixture(async({request,calls})=>{const r=await request(undefined,{method});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET');assert.equal(calls.length,0);}));
test('unknown personal endpoint is not served',()=>fixture(async({request,calls})=>{assert.equal((await request('/v1/me/users')).status,404);assert.equal(calls.length,0);}));
test('storage errors are redacted rather than passed through or treated as empty success',()=>fixture(async({request,logs})=>{const r=await request();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/postgres|password/);assert.equal(logs[0].code,'DIRECTORY_UNAVAILABLE');assert.equal(Object.keys(logs[0]).length,2);},{fail:true}));
