import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHttpHandler } from '../src/http.mjs';
import { ApiError } from '../src/errors.mjs';
const path='/v1/orgs/11111111-1111-4111-8111-111111111111/projects/22222222-2222-4222-8222-222222222222/github-evidence';
async function fixture(fn,{enabled=true,deny=false}={}) {
 const calls=[];
 const handler=createHttpHandler({service:{},authenticate:async()=>{if(deny)throw new ApiError(401,'UNAUTHENTICATED','Sign in');return{subject:'verified'};},
  githubService:enabled?{inspect:async(...args)=>{calls.push(args);return{summary:'Insufficient evidence',readinessEffect:'none'};}}:null});
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await fn({calls,request:(suffix='',options={})=>fetch(`http://127.0.0.1:${server.address().port}${path}${suffix}`,options)});}finally{server.closeAllConnections();server.close();await once(server,'close');}
}
test('authenticated GET reaches read-only inspector with exact parameters',()=>fixture(async({calls,request})=>{const res=await request('?buildId=BLD-001&runId=30&attempt=1');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(calls.length,1);assert.deepEqual(calls[0][3],{buildId:'BLD-001',runId:'30',attempt:'1'});}));
for(const suffix of ['?runId=30&runId=31','?token=secret','?url=https://evil.test','?repository=other/repo'])test(`reject unexpected query ${suffix}`,()=>fixture(async({calls,request})=>{assert.equal((await request(suffix)).status,400);assert.equal(calls.length,0);}));
test('POST cannot trigger collection or a workflow',()=>fixture(async({calls,request})=>{assert.equal((await request('',{method:'POST'})).status,404);assert.equal(calls.length,0);}));
test('disabled connector returns 404',()=>fixture(async({request})=>assert.equal((await request()).status,404),{enabled:false}));
test('unauthenticated request never reaches provider',()=>fixture(async({calls,request})=>{assert.equal((await request()).status,401);assert.equal(calls.length,0);},{deny:true}));
