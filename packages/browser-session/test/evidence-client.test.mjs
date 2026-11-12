import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubEvidenceClient } from '../src/evidence-client.mjs';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64);
const target={buildId:'BLD-001',runId:'30',attempt:'1'};
function fixture(override){
 const build={id:'BLD-001',commitSha:sha,artifactDigest:digest,environment:'staging'};
 const value={schemaVersion:1,kind:'github-run-observation',orgId:org,projectId:project,projectRevision:3,target:{buildId:build.id,...build},source:{id:30,attempt:1,repository:'Example/Project',url:'https://github.com/Example/Project/actions/runs/30/attempts/1',commitSha:sha},summary:'Reported success',artifactVerified:false,testCoverageVerified:false,readinessEffect:'none',collectedAt:new Date().toISOString(),contentSha256:'a'.repeat(64),criteria:[{name:'Build',state:'Reported success',reason:'Metadata only'}],jobs:[],limitations:['Not artifact proof']};
 const calls=[],api={authenticated:true,orgId:org,generation:1,project:{id:project,revision:3,builds:[build]},request:async path=>{calls.push(path);return override?override(value,api):structuredClone(value);}};
 return{api,value,calls,client:new GitHubEvidenceClient(api)};
}
test('reads exact context through existing cookie transport',async()=>{const f=fixture();assert.equal((await f.client.inspect(target)).summary,'Reported success');assert.equal(f.calls.length,1);assert.match(f.calls[0],/github-evidence\?buildId=BLD-001&runId=30&attempt=1$/);});
for(const key of ['orgId','projectId','projectRevision','kind','readinessEffect','artifactVerified','testCoverageVerified','summary','contentSha256'])test(`reject mismatched ${key}`,async()=>{const f=fixture(v=>({...v,[key]:'wrong'}));await assert.rejects(f.client.inspect(target),e=>e.code==='INVALID_EVIDENCE');assert.equal(f.client.value,null);});
for(const key of ['buildId','commitSha','artifactDigest','environment'])test(`reject target ${key}`,async()=>{const f=fixture(v=>({...v,target:{...v.target,[key]:'wrong'}}));await assert.rejects(f.client.inspect(target));});
for(const key of ['id','attempt','commitSha','repository','url'])test(`reject source ${key}`,async()=>{const f=fixture(v=>({...v,source:{...v.source,[key]:'https://evil.test'}}));await assert.rejects(f.client.inspect(target));});
test('context switch suppresses a late response',async()=>{const f=fixture((v,a)=>{a.generation++;return v;});await assert.rejects(f.client.inspect(target),e=>e.code==='STALE_CONTEXT');});
test('requirement revision change suppresses a late response',async()=>{const f=fixture((v,a)=>{a.project={...a.project,revision:4};return v;});await assert.rejects(f.client.inspect(target),e=>e.code==='STALE_CONTEXT');});
test('clear during a request suppresses its response',async()=>{let release;const f=fixture(v=>new Promise(r=>{release=()=>r(v);}));const job=f.client.inspect(target);f.client.clear();release();await assert.rejects(job,e=>e.code==='STALE_CONTEXT');});
test('an invalid new selection clears previous observation',async()=>{const f=fixture();await f.client.inspect(target);await assert.rejects(f.client.inspect({...target,runId:'not-numeric'}));assert.equal(f.client.value,null);assert.equal(f.calls.length,1);});
test('failed refresh clears previous observation',async()=>{const f=fixture();await f.client.inspect(target);f.api.request=async()=>{throw new Error('unavailable');};await assert.rejects(f.client.inspect(target));assert.equal(f.client.value,null);});
test('empty required criteria is not accepted',async()=>{const f=fixture(v=>({...v,criteria:[]}));await assert.rejects(f.client.inspect(target));});
