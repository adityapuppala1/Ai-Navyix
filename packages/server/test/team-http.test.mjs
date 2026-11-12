import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {createHttpHandler} from '../src/http.mjs';import {ApiError}from'../src/errors.mjs';
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const principal={issuer:'https://test.example',subject:'fixture'};const base=`/v1/orgs/${org}/projects/${project}/team`;
async function fixture(run,{enabled=true,failure=false}={}){
 const calls=[];const teamService={async list(...args){calls.push(args);if(failure)throw new ApiError(404,'NOT_FOUND','Unavailable');return{members:[]};},async change(...args){calls.push(args);return{accepted:true};}};
 const server=createServer(createHttpHandler({service:{},teamService:enabled?teamService:null,authenticate:async value=>{if(value!=='Bearer fixture')throw new ApiError(401,'UNAUTHENTICATED','No token');return principal;}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 try{await run((path=base,init={})=>fetch(origin+path,{...init,headers:{authorization:'Bearer fixture',...init.headers}}),calls);}finally{await new Promise(r=>server.close(r));}
}
test('team directory passes authenticated scope and pagination',()=>fixture(async(req,calls)=>{const r=await req(base+'?limit=50');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(calls[0],[principal,org,project,{after:undefined,limit:50}]);}));
test('team change forwards idempotency key with body',()=>fixture(async(req,calls)=>{const r=await req(base+'/commands',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'id'},body:'{"role":"VIEWER"}'});assert.equal(r.status,200);assert.equal(calls[0][4],'id');assert.deepEqual(calls[0][3],{role:'VIEWER'});}));
for(const suffix of ['?limit=0','?limit=50&limit=20','?actorId=forged'])test('bad team query '+suffix,()=>fixture(async(req,calls)=>{assert.equal((await req(base+suffix)).status,400);assert.equal(calls.length,0);}));
test('disabled feature has no team endpoint',()=>fixture(async(req,calls)=>{assert.equal((await req()).status,404);assert.equal(calls.length,0);},{enabled:false}));
test('API authority denial reaches caller without member data',()=>fixture(async(req)=>{const r=await req();assert.equal(r.status,404);assert.equal((await r.json()).error.code,'NOT_FOUND');},{failure:true}));
test('no authentication no directory',()=>fixture(async(req,calls)=>{assert.equal((await req(base,{headers:{authorization:''}})).status,401);assert.equal(calls.length,0);}));
test('mutation requires JSON',()=>fixture(async(req,calls)=>{assert.equal((await req(base+'/commands',{method:'POST',body:'x'})).status,415);assert.equal(calls.length,0);}));
test('read route cannot mutate',()=>fixture(async(req,calls)=>{assert.equal((await req(base,{method:'POST'})).status,404);assert.equal(calls.length,0);}));
