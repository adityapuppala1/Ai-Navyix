import test from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationDirectory } from '../src/organization-client.mjs';
import { organizationProxyTarget } from '../src/organization-route.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=n=>({id:id(n),name:'Org '+n,role:'VIEWER'});
function fixture(response={organizations:[row(1)],next:null}){
 const calls=[];const workspace={authenticated:true,generation:1,pending:null,request:async p=>{calls.push(p);return response;}};
 return{workspace,api:new OrganizationDirectory(workspace),calls};
}
test('directory uses same-session GET transport without identity parameters',async()=>{const{api,calls}=fixture();await api.load();assert.deepEqual(calls,['api/me/organizations?limit=20']);assert.equal(api.select(id(1)),id(1));});
test('empty directory remains empty and never invents membership',async()=>{const{api}=fixture({organizations:[],next:null});await api.load();assert.equal(api.rows.length,0);assert.throws(()=>api.select(id(1)));});
test('failed refresh clears previous organization names',async()=>{const{api,workspace}=fixture();await api.load();workspace.request=async()=>{throw Object.assign(new Error('Access unavailable'),{status:404});};await assert.rejects(api.load());assert.deepEqual(api.rows,[]);assert.equal(api.next,null);});
test('session loss suppresses in-flight directory and prevents selection',async()=>{
 const{api,workspace}=fixture();let resolve;workspace.request=()=>new Promise(r=>resolve=r);const load=api.load();workspace.generation++;workspace.authenticated=false;resolve({organizations:[row(1)],next:null});await assert.rejects(load,e=>e.code==='STALE_CONTEXT');assert.equal(api.rows.length,0);assert.throws(()=>api.select(id(1)));
});
test('older response cannot overwrite a newer page',async()=>{
 const{api,workspace}=fixture();let resolve;workspace.request=()=>new Promise(r=>resolve=r);const old=api.load();workspace.request=async()=>({organizations:[row(2)],next:null});await api.load();resolve({organizations:[row(1)],next:null});await assert.rejects(old,e=>e.code==='STALE_CONTEXT');assert.equal(api.rows[0].id,id(2));
});
test('disposed component ignores late response',async()=>{const{api,workspace}=fixture();let resolve;workspace.request=()=>new Promise(r=>resolve=r);const load=api.load();api.dispose();resolve({organizations:[row(1)],next:null});await assert.rejects(load,e=>e.code==='STALE_CONTEXT');assert.equal(api.rows.length,0);});
test('unconfirmed writes block lookup and selection',async()=>{const{api,workspace,calls}=fixture();workspace.pending={};await assert.rejects(api.load(),e=>e.code==='PENDING_WRITE');assert.equal(calls.length,0);workspace.pending=null;await api.load();workspace.pending={};assert.throws(()=>api.select(id(1)),e=>e.code==='PENDING_WRITE');});
test('pagination uses server cursor and retains only current page',async()=>{
 const rows=Array.from({length:20},(_,i)=>row(i+1));const{api,workspace,calls}=fixture({organizations:rows,next:id(20)});await api.load();assert.equal(api.next,id(20));workspace.request=async path=>{calls.push(path);return{organizations:[row(21)],next:null};};await api.load(api.next);assert.equal(api.rows.length,1);assert.ok(calls.at(-1).endsWith('&after='+id(20)));
});
for(const value of [{organizations:[row(1),row(1)],next:null},{organizations:[row(2),row(1)],next:null},{organizations:[{...row(1),role:'ROOT'}],next:null},{organizations:[],next:id(1)},{organizations:[row(1)],next:'bad'},{organizations:[row(1)]},null])
 test('rejects malformed directory '+JSON.stringify(value),async()=>{const{api}=fixture(value);await assert.rejects(api.load(),e=>e.code==='INVALID_DIRECTORY');assert.equal(api.rows.length,0);});
test('display values are copied and cannot inject extra server fields',async()=>{const r={organizations:[{...row(1),token:'never copy'}],next:null};const{api}=fixture(r);await api.load();r.organizations[0].name='mutated';assert.equal(api.rows[0].name,'Org 1');assert.equal(api.rows[0].token,undefined);assert.ok(Object.isFrozen(api.rows[0]));});
test('unknown organization choice is rejected locally; server still owns authorization',async()=>{const{api}=fixture();await api.load();assert.throws(()=>api.select(id(9)),e=>e.code==='INVALID_ORGANIZATION');});
const url=q=>new URL('https://app.example/api/browser/api/me/organizations'+q);
test('proxy routes only the exact own-membership resource',()=>{assert.equal(organizationProxyTarget(url('?limit=20'),'GET'),'/v1/me/organizations?limit=20');assert.equal(organizationProxyTarget(new URL('https://app.example/api/browser/api/me/users'),'GET'),null);});
for(const method of ['POST','PUT','DELETE'])test('proxy denies '+method,()=>assert.throws(()=>organizationProxyTarget(url(''),method),e=>e.status===405));
for(const q of ['?userId=x','?orgId=x','?role=OWNER','?url=https://other','?limit=01','?limit=0','?limit=51','?limit=1&limit=2','?after=bad','?after='])
 test('proxy denies query '+q,()=>assert.throws(()=>organizationProxyTarget(url(q),'GET'),e=>e.code==='INVALID_QUERY' && e.status===400));

test('lookup after sign-out clears names already loaded in the directory',async()=>{
 const{api,workspace}=fixture();await api.load();workspace.authenticated=false;
 await assert.rejects(api.load(),e=>e.code==='SIGN_IN_REQUIRED');assert.deepEqual(api.rows,[]);assert.equal(api.context,null);
});
test('selection after a session change erases previously loaded names',async()=>{
 const{api,workspace}=fixture();await api.load();workspace.generation++;
 assert.throws(()=>api.select(id(1)),e=>e.code==='STALE_CONTEXT');assert.deepEqual(api.rows,[]);
});
