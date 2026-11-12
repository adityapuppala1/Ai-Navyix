import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { browserConfig } from '../src/config.mjs';
import { browserHandler } from '../src/handler.mjs';
import { env, org, MemorySessions } from './support/fixtures.mjs';

test('real loopback HTTP: login callback, cookie session, API forwarding and logout',async t=>{
  const observed=[];
  const api=http.createServer((req,res)=>{observed.push({url:req.url,authorization:req.headers.authorization,cookie:req.headers.cookie});res.writeHead(200,{'content-type':'application/json'});res.end('{"projects":[],"next":null}');});
  api.listen(0,'127.0.0.1');await once(api,'listening');
  let handler;
  const web=http.createServer(async(req,res)=>{
    const chunks=[];for await(const part of req)chunks.push(part);
    const request=new Request(`http://127.0.0.1:${web.address().port}${req.url}`,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    const response=await handler(request);
    for(const [key,value]of response.headers)if(key!=='set-cookie')res.setHeader(key,value);
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
    res.writeHead(response.status);res.end(Buffer.from(await response.arrayBuffer()));
  });
  web.listen(0,'127.0.0.1');await once(web,'listening');
  t.after(()=>{web.closeAllConnections();api.closeAllConnections();web.close();api.close();});
  const origin=`http://127.0.0.1:${web.address().port}`;
  const config=browserConfig({...env,NODE_ENV:'test',NAVYIX_ALLOW_HTTP_LOOPBACK:'true',NAVYIX_PUBLIC_ORIGIN:origin,NAVYIX_API_ORIGIN:`http://127.0.0.1:${api.address().port}`});
  handler=browserHandler({config,store:new MemorySessions(),oidc:{exchange:async()=>({accessToken:'test-upstream-access',expiresAt:Date.now()+600000})}});
  assert.equal((await fetch(origin+'/api/browser/session')).status,401);
  const login=await fetch(origin+'/api/browser/login',{method:'POST',headers:{origin},redirect:'manual'});assert.equal(login.status,303);
  const loginCookie=login.headers.getSetCookie()[0].split(';')[0],state=new URL(login.headers.get('location')).searchParams.get('state');
  const callback=await fetch(origin+`/api/browser/callback?state=${state}&code=integration-code`,{headers:{cookie:loginCookie},redirect:'manual'});assert.equal(callback.status,303);
  const cookie=callback.headers.getSetCookie().find(c=>c.startsWith(config.sessionCookie+'=')).split(';')[0];
  const session=await(await fetch(origin+'/api/browser/session',{headers:{cookie}})).json();assert.equal(session.authenticated,true);
  const projects=await fetch(origin+`/api/browser/api/orgs/${org}/projects`,{headers:{cookie}});assert.equal(projects.status,200);
  assert.equal(observed[0].authorization,'Bearer test-upstream-access');assert.equal(observed[0].cookie,undefined);assert.equal(observed[0].url,`/v1/orgs/${org}/projects`);
  assert.equal((await fetch(origin+'/api/browser/logout',{method:'POST',headers:{cookie,origin,'x-navyix-csrf':session.csrfToken}})).status,200);
  assert.equal((await fetch(origin+'/api/browser/session',{headers:{cookie}})).status,401);
});
