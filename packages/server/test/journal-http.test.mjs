import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createEvidenceJournalHandler } from '../src/evidence-journal-http.mjs';
import { ApiError } from '../src/errors.mjs';
import { fixture,ORG,PROJECT,INPUT,PRINCIPAL } from './support/journal-fixture.mjs';
async function server(t){const f=fixture();const handler=createEvidenceJournalHandler({service:f.service,authenticate:async header=>{if(header!=='Bearer fixture')throw new ApiError(401,'UNAUTHENTICATED','Sign in.');return PRINCIPAL;}});
 const s=http.createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end('fallback');}));s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>{s.closeAllConnections();s.close();});
 const origin=`http://127.0.0.1:${s.address().port}`,path=`/v1/orgs/${ORG}/projects/${PROJECT}/github-observations`;
 return{...f,origin,path,call:(suffix='',options={})=>fetch(origin+path+suffix,{...options,headers:{authorization:'Bearer fixture',...options.headers}})};
}
test('actual HTTP capture, history and detail round trip',async t=>{const f=await server(t);const r=await f.call('',{method:'POST',headers:{'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify(INPUT)});assert.equal(r.status,201);assert.equal(r.headers.get('cache-control'),'no-store');const ack=await r.json();const list=await(await f.call()).json();assert.equal(list.observations[0].id,ack.observationId);assert.equal((await(await f.call('/'+ack.observationId)).json()).observation.readinessEffect,'none');});
test('HTTP missing identity is rejected',async t=>{const f=await server(t);assert.equal((await f.call('',{headers:{authorization:''}})).status,401);assert.equal(f.control.fetches,0);});
test('HTTP rejects unsupported write methods and unknown queries',async t=>{const f=await server(t);assert.equal((await f.call('',{method:'DELETE'})).status,405);for(const q of ['?url=https://evil.test','?limit=0','?limit=21','?limit=1&limit=2','?after=x'])assert.equal((await f.call(q)).status,400);});
test('HTTP rejects uploaded observations instead of collecting them',async t=>{const f=await server(t);const r=await f.call('',{method:'POST',headers:{'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({...INPUT,observation:{summary:'Ready'}})});assert.equal(r.status,400);assert.equal(f.control.fetches,0);});
for(const [label,options,status] of [
 ['wrong type',{headers:{'content-type':'text/plain'},body:'{}'},415],['broken JSON',{headers:{'content-type':'application/json'},body:'{'},400],
 ['large JSON',{headers:{'content-type':'application/json'},body:'x'.repeat(5000)},413],['compressed input',{headers:{'content-type':'application/json','content-encoding':'gzip'},body:'{}'},415],
 ['missing request ID',{headers:{'content-type':'application/json'},body:JSON.stringify(INPUT)},400]
])test(`HTTP ${label}`,async t=>{const f=await server(t);assert.equal((await f.call('',{method:'POST',...options})).status,status);assert.equal(f.state.records.length,0);});
test('HTTP does not mutate a stored record via POST',async t=>{const f=await server(t),ack=await f.capture();assert.equal((await f.call('/'+ack.observationId,{method:'POST'})).status,405);});
test('HTTP redacts unexpected storage error details',async t=>{const f=await server(t);f.repository.transaction=async()=>{throw Error('password=secret');};const r=await f.call();assert.equal(r.status,500);assert.ok(!(await r.text()).includes('secret'));});
test('middleware does not intercept the existing project routes',async t=>{const f=await server(t);const r=await fetch(f.origin+`/v1/orgs/${ORG}/projects`);assert.equal(await r.text(),'fallback');});
