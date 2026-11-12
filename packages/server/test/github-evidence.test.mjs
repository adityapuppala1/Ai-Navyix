import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubEvidenceService, githubConnections } from '../src/github-evidence.mjs';
import { ApiError } from '../src/errors.mjs';
const orgId='11111111-1111-4111-8111-111111111111', projectId='22222222-2222-4222-8222-222222222222';
const NOW=Date.parse('2026-11-12T04:00:00Z'), commitSha='a'.repeat(40), digest='sha256:'+'b'.repeat(64);
const principal={issuer:'https://issuer.example',subject:'subject'};
const binding={orgId,projectId,repository:'Example/Project',repositoryId:10,workflowIds:[20],requiredJobs:['Build','Tests'],events:['workflow_dispatch'],tokenEnv:'NAVYIX_GITHUB_TOKEN_PILOT'};
const env={NAVYIX_API_ENABLED:'true',NAVYIX_GITHUB_ENABLED:'true',NAVYIX_GITHUB_TOKEN_PILOT:'test-secret-only',NAVYIX_GITHUB_CONNECTIONS:JSON.stringify([binding])};
const target={buildId:'BLD-001',runId:'30',attempt:'1'};
const run=()=>({id:30,run_attempt:1,head_sha:commitSha,workflow_id:20,repository:{id:10,full_name:'Example/Project'},head_repository:{id:10},event:'workflow_dispatch',status:'completed',conclusion:'success',created_at:'2026-11-12T01:00:00Z',updated_at:'2026-11-12T02:00:00Z'});
const job=(id=40,name='Build')=>({id,name,run_id:30,run_attempt:1,head_sha:commitSha,status:'completed',conclusion:'success',started_at:'2026-11-12T01:10:00Z',completed_at:'2026-11-12T01:20:00Z'});
function fixture({override, read, bindings=githubConnections(env)}={}) {
 let gets=0;const requests=[];
 const project={id:projectId,revision:3,builds:[{id:'BLD-001',commitSha,artifactDigest:digest,environment:'staging'}]};
 const workflow={get:async(...args)=>{gets++;if(read)return read(gets,project,args);return structuredClone(project);}};
 const fetcher=async(url,options)=>{requests.push({url,options});const found=await override?.(url,options,requests.length);if(found)return found;
   return Response.json(url.includes('/jobs?')?{total_count:2,jobs:[job(),job(41,'Tests')]}:run());};
 const service=new GitHubEvidenceService(workflow,bindings,{fetcher,secrets:env,clock:()=>NOW});
 return {service,requests,project,inspect:(changes={})=>service.inspect(principal,orgId,projectId,{...target,...changes}),gets:()=>gets};
}
test('disabled connector needs no secrets or network',()=>assert.deepEqual(githubConnections({}),[]));
test('valid trusted configuration is immutable and does not contain a token',()=>{const b=githubConnections(env)[0];assert.equal(b.repositoryId,10);assert.equal(JSON.stringify(b).includes(env.NAVYIX_GITHUB_TOKEN_PILOT),false);assert.ok(Object.isFrozen(b.workflowIds));});
for(const [label,change] of [
 ['API disabled',{NAVYIX_API_ENABLED:'false'}],['invalid feature flag',{NAVYIX_GITHUB_ENABLED:'yes'}],['no bindings',{NAVYIX_GITHUB_CONNECTIONS:'[]'}],['invalid JSON',{NAVYIX_GITHUB_CONNECTIONS:'x'}],['token absent',{NAVYIX_GITHUB_TOKEN_PILOT:''}],['header injection',{NAVYIX_GITHUB_TOKEN_PILOT:'secret\r\nx: injected'}]
])test(`configuration rejects ${label}`,()=>assert.throws(()=>githubConnections({...env,...change})));
for(const [label,change] of [
 ['cross-source URL',{repository:'https://attacker.test/steal'}],['path traversal',{repository:'Example/..'}],['query injection',{repository:'Example/repo?x'}],['no repository ID',{repositoryId:0}],['no workflows',{workflowIds:[]}],['duplicate workflow',{workflowIds:[20,20]}],['no required jobs',{requiredJobs:[]}],['duplicate jobs',{requiredJobs:['Build','Build']}],['unapproved event',{events:['pull_request_target']}],['arbitrary environment secret',{tokenEnv:'DATABASE_URL'}],['missing project',{projectId:null}],['unexpected key',{url:'https://attacker.test'}]
])test(`configuration rejects ${label}`,()=>assert.throws(()=>githubConnections({...env,NAVYIX_GITHUB_CONNECTIONS:JSON.stringify([{...binding,...change}])})));
test('duplicate project bindings are rejected',()=>assert.throws(()=>githubConnections({...env,NAVYIX_GITHUB_CONNECTIONS:JSON.stringify([binding,binding])})));
test('reports metadata without turning it into readiness or artifact proof',async()=>{
 const f=fixture(),observation=await f.inspect();assert.equal(observation.summary,'Reported success');assert.equal(observation.readinessEffect,'none');assert.equal(observation.artifactVerified,false);assert.equal(observation.testCoverageVerified,false);assert.equal(observation.projectRevision,3);assert.match(observation.contentSha256,/^[a-f0-9]{64}$/);assert.equal(f.gets(),2);
 assert.equal(JSON.stringify(observation).includes('test-secret-only'),false);assert.equal(f.requests.length,3);
 for(const {url,options}of f.requests){assert.ok(url.startsWith('https://api.github.com/repos/Example/Project/actions/runs/30/attempts/1'));assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);}
});
test('denied member causes no upstream call',async()=>{const f=fixture({read:async()=>{throw new ApiError(404,'NOT_FOUND','Denied');}});await assert.rejects(f.inspect(),e=>e.status===404);assert.equal(f.requests.length,0);});
test('project without a binding cannot borrow another project connection',async()=>{const f=fixture({bindings:[{...binding,projectId:orgId}]});await assert.rejects(f.inspect(),e=>e.code==='GITHUB_NOT_CONFIGURED');assert.equal(f.requests.length,0);});
for(const change of [{runId:'../dispatches'},{runId:'9007199254740993'},{attempt:'0'},{attempt:'1001'},{buildId:'BLD-999'},{repository:'evil/repo'},{token:'steal'}])test(`invalid request ${JSON.stringify(change)} makes no calls`,async()=>{const f=fixture();await assert.rejects(f.inspect(change));assert.equal(f.requests.length,0);});
for(const [label,change]of[
 ['repository',{repository:{id:999,full_name:'Example/Project'}}],['renamed repository',{repository:{id:10,full_name:'Other/Project'}}],['fork',{head_repository:{id:999}}],['workflow',{workflow_id:999}],['event',{event:'pull_request_target'}],['commit',{head_sha:'c'.repeat(40)}],['run',{id:31}],['attempt',{run_attempt:2}],['status',{status:'mystery'}],['conclusion',{conclusion:'mystery'}],['future',{updated_at:'2099-01-01T00:00:00Z'}]
])test(`rejects mismatched ${label}`,async()=>{const f=fixture({override:url=>!url.includes('/jobs?')?Response.json({...run(),...change}):undefined});await assert.rejects(f.inspect(),e=>e.code==='GITHUB_INVALID_RESPONSE');});
for(const [status,expected]of[['skipped','Skipped'],['cancelled','Cancelled'],['failure','Reported failure'],['timed_out','Reported failure'],['neutral','Reported failure']])test(`${status} cannot count as reported success`,async()=>{const f=fixture({override:url=>url.includes('/jobs?')?Response.json({total_count:2,jobs:[job(),{...job(41,'Tests'),conclusion:status}]}):undefined});const r=await f.inspect();assert.equal(r.criteria[1].state,expected);assert.equal(r.summary,'Insufficient evidence');});
test('a pending job remains not completed',async()=>{const f=fixture({override:url=>url.includes('/jobs?')?Response.json({total_count:2,jobs:[job(),{...job(41,'Tests'),status:'queued',conclusion:null,started_at:null,completed_at:null}]}):undefined});assert.equal((await f.inspect()).criteria[1].state,'Not completed');});
test('a green workflow with zero jobs is insufficient evidence',async()=>{const f=fixture({override:url=>url.includes('/jobs?')?Response.json({total_count:0,jobs:[]}):undefined});assert.equal((await f.inspect()).summary,'Insufficient evidence');});
test('success without execution timestamps is insufficient evidence',async()=>{const f=fixture({override:url=>url.includes('/jobs?')?Response.json({total_count:2,jobs:[job(),{...job(41,'Tests'),started_at:null,completed_at:null}]}):undefined});assert.equal((await f.inspect()).criteria[1].state,'Missing timestamps');});
test('duplicate job names cannot silently satisfy requirements',async()=>{const f=fixture({override:url=>url.includes('/jobs?')?Response.json({total_count:3,jobs:[job(),job(41,'Tests'),job(42,'Tests')]}):undefined});assert.equal((await f.inspect()).criteria[1].state,'Ambiguous');});
test('failed workflow is not successful even when required jobs succeeded',async()=>{const f=fixture({override:url=>!url.includes('/jobs?')?Response.json({...run(),conclusion:'failure'}):undefined});assert.equal((await f.inspect()).summary,'Not successful');});
test('reads all attempt-specific job pages without following Link URLs',async()=>{
 const first=Array.from({length:100},(_,i)=>job(100+i,`Other ${i}`));
 const f=fixture({override:url=>url.includes('/jobs?')?Response.json(url.endsWith('page=1')?{total_count:102,jobs:first}:{total_count:102,jobs:[job(),job(41,'Tests')]},{headers:{link:'<https://evil.example/steal>; rel="next"'}}):undefined});
 assert.equal((await f.inspect()).jobs.length,102);assert.equal(f.requests.length,4);assert.ok(f.requests.every(r=>!r.url.includes('evil')));
});
for(const [label,payload]of[
 ['truncated',{total_count:3,jobs:[job()]}],['duplicate IDs',{total_count:2,jobs:[job(),job()]}],['wrong run',{total_count:1,jobs:[{...job(),run_id:31}]}],['wrong attempt',{total_count:1,jobs:[{...job(),run_attempt:2}]}],['wrong commit',{total_count:1,jobs:[{...job(),head_sha:'b'.repeat(40)}]}],['too many',{total_count:501,jobs:[]}],['invalid count',{total_count:'2',jobs:[]}]
])test(`rejects ${label} job response`,async()=>{const f=fixture({override:url=>url.includes('/jobs?')?Response.json(payload):undefined});await assert.rejects(f.inspect(),e=>e.status===502);});
test('changing run metadata during collection is rejected',async()=>{const f=fixture({override:(url,opt,n)=>n===3?Response.json({...run(),updated_at:'2026-11-12T03:00:00Z'}):undefined});await assert.rejects(f.inspect(),e=>e.code==='EVIDENCE_CHANGED');});
test('project changed during collection is rejected',async()=>{const f=fixture({read:(n,p)=>({...p,revision:n===1?3:4})});await assert.rejects(f.inspect(),e=>e.code==='REVISION_CONFLICT');});
test('revoked access is checked again before evidence is returned',async()=>{const f=fixture({read:(n,p)=>{if(n===2)throw new ApiError(404,'NOT_FOUND','Denied');return p;}});await assert.rejects(f.inspect(),e=>e.status===404);assert.equal(f.requests.length,3);});
for(const status of [301,302,307,401,403,404,500,503])test(`HTTP ${status} is not a successful observation`,async()=>{const f=fixture({override:()=>new Response('secret provider error',{status,headers:{location:'https://evil.example'}})});await assert.rejects(f.inspect(),e=>e.status===503&&!e.message.includes('secret'));assert.equal(f.requests.length,1);});
test('rate limit blocks subsequent explicit collection without retry loops',async()=>{const f=fixture({override:()=>new Response('',{status:429,headers:{'retry-after':'120'}})});await assert.rejects(f.inspect(),e=>e.status===429);await assert.rejects(f.inspect(),e=>e.status===429);assert.equal(f.requests.length,1);});
test('network failures redact credentials and free concurrency slot',async()=>{const f=fixture({override:()=>{throw new Error('test-secret-only');}});await assert.rejects(f.inspect(),e=>e.status===503&&!e.message.includes('secret'));assert.equal(f.service.active.size,0);});
test('non-JSON body is rejected',async()=>{const f=fixture({override:()=>new Response('<html>gateway</html>',{headers:{'content-type':'text/html'}})});await assert.rejects(f.inspect(),e=>e.status===502);});
test('oversized streamed body is rejected without using unbounded response.json',async()=>{const f=fixture({override:()=>new Response('x'.repeat(1_000_001),{headers:{'content-type':'application/json'}})});await assert.rejects(f.inspect(),e=>e.status===502);});
test('malformed JSON fails without leaking the body',async()=>{const f=fixture({override:()=>new Response('secret-invalid-json',{headers:{'content-type':'application/json'}})});await assert.rejects(f.inspect(),e=>e.status===503&&!e.message.includes('secret'));});
test('parallel same-project collection is rejected before additional upstream requests',async()=>{let release;const f=fixture({override:(u,o,n)=>n===1?new Promise(r=>{release=()=>r(Response.json(run()));}):undefined});const first=f.inspect();await new Promise(r=>setImmediate(r));await assert.rejects(f.inspect(),e=>e.status===429);release();await first;assert.equal(f.requests.length,3);});
