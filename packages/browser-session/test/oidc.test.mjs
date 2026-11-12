import test from 'node:test';
import assert from 'node:assert/strict';
import { browserConfig } from '../src/config.mjs';
import { oidcClient } from '../src/oidc.mjs';
import { env } from './support/fixtures.mjs';
const now=Date.parse('2026-11-11T10:00:00Z'), sec=now/1000;
function fixture({ id={}, access={}, protectedHeader={}, response={}, verifyError=false, profile='jwt-access', secret=false }={}) {
  const config=browserConfig({...env,OIDC_TOKEN_PROFILE:profile,...(secret?{NAVYIX_OIDC_CLIENT_AUTH:'client_secret_basic',NAVYIX_OIDC_CLIENT_SECRET:'secret:with:colon'}:{})});
  const calls=[];
  const identity={iss:config.issuer,sub:'user-a',aud:config.clientId,iat:sec-5,exp:sec+1800,nonce:'nonce',...id};
  const claims={iss:config.issuer,sub:'user-a',aud:config.audience,iat:sec-5,exp:sec+1800,scope:config.scope,...(profile==='cognito-access'?{token_use:'access',client_id:config.clientId}:{}),...access};
  // Test double for claim-policy checks; real signature tests live in integration.test.mjs.
  const jose={createRemoteJWKSet:()=>({test:true}),jwtVerify:async(token,keys,options)=>{
    calls.push({token,options}); if(verifyError)throw new Error('signature failure');
    return {payload:token==='id.jwt.signature'?identity:claims,protectedHeader:{alg:'RS256',typ:'at+jwt',...protectedHeader}};
  }};
  let request;
  const client=oidcClient(config,jose,async(url,init)=>{request={url,init};return Response.json({id_token:'id.jwt.signature',access_token:'access.jwt.signature',token_type:'Bearer',...response});},()=>now);
  return {client,config,calls,get request(){return request}};
}
test('OIDC sends PKCE and validates ID plus API access token',async()=>{
  const f=fixture(), result=await f.client.exchange('code','verifier','nonce');assert.equal(result.subject,'user-a');assert.equal(f.calls.length,2);
  assert.match(f.request.init.body,/code_verifier=verifier/);assert.equal(f.request.init.redirect,'error');assert.equal(f.calls[0].options.audience,'test-client');assert.equal(f.calls[1].options.audience,'navyix-api');
});
test('confidential client uses encoded Basic authentication, not a browser secret',async()=>{
 const f=fixture({secret:true});await f.client.exchange('code','verifier','nonce');assert.ok(f.request.init.headers.authorization.startsWith('Basic '));assert.ok(!f.request.init.body.includes('secret'));
});
for(const [name,id] of Object.entries({nonce:{nonce:'wrong'},subject:{sub:''},issuer:{iss:'https://evil.test'},audience:{aud:'other'},expired:{exp:sec-1},future:{iat:sec+100},azp:{azp:'other'},multiAudience:{aud:['test-client','other']},tokenUse:{token_use:'access'},accessHash:{at_hash:'wrong'}}))
 test(`ID token policy rejects ${name}`,async()=>assert.rejects(fixture({id}).client.exchange('code','verifier','nonce'),e=>e.status===401&&e.code==='LOGIN_FAILED'));
for(const [name,access] of Object.entries({subject:{sub:'different'},scope:{scope:'openid'},expired:{exp:sec-1},lifetime:{iat:sec-5,exp:sec+7200},audience:{aud:'different'}}))
 test(`access token policy rejects ${name}`,async()=>assert.rejects(fixture({access}).client.exchange('code','verifier','nonce'),e=>e.status===401));
test('signature verification failures cannot create a session',async()=>assert.rejects(fixture({verifyError:true}).client.exchange('code','verifier','nonce'),e=>e.status===401));
test('an ID token cannot be used as a generic access token',async()=>assert.rejects(fixture({protectedHeader:{typ:'JWT'}}).client.exchange('code','verifier','nonce'),e=>e.status===401));
test('Cognito profile validates access-token client and token_use',async()=>{
 assert.equal((await fixture({profile:'cognito-access'}).client.exchange('code','verifier','nonce')).subject,'user-a');
 await assert.rejects(fixture({profile:'cognito-access',access:{token_use:'id'}}).client.exchange('code','verifier','nonce'));
 await assert.rejects(fixture({profile:'cognito-access',access:{client_id:'other'}}).client.exchange('code','verifier','nonce'));
});
for(const response of [{token_type:'MAC'},{id_token:''},{access_token:'opaque-token'},{id_token:'a'.repeat(9000)}])
 test(`token response rejects ${Object.keys(response)[0]}=${String(Object.values(response)[0]).slice(0,12)}`,async()=>assert.rejects(fixture({response}).client.exchange('code','verifier','nonce')));
test('provider errors are redacted',async()=>{
 const c=browserConfig(env),client=oidcClient(c,{createRemoteJWKSet:()=>({})},async()=>{throw new Error('client_secret=secret');});
 await assert.rejects(client.exchange('code','verifier','nonce'),e=>!e.message.includes('client_secret')&&e.status===401);
});
