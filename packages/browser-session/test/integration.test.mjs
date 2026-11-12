import test from 'node:test';
import assert from 'node:assert/strict';
import { browserConfig } from '../src/config.mjs';
import { oidcClient } from '../src/oidc.mjs';
import { PostgresSessions } from '../src/postgres.mjs';
import { hash, randomToken } from '../src/crypto.mjs';
import { env } from './support/fixtures.mjs';
const required=process.env.NAVYIX_REQUIRE_BROWSER_INTEGRATION==='1';
async function dependency(name,t){try{return await import(name);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;if(required)throw new Error(`${name} is required for the strict integration gate.`);t.skip(`${name} is not installed; integration not executed.`);return null;}}

test('real JOSE verifies generated signatures and rejects tampering',async t=>{
 const jose=await dependency('jose',t);if(!jose)return;
 const config=browserConfig(env),{publicKey,privateKey}=await jose.generateKeyPair('RS256',{extractable:true});
 const jwk=await jose.exportJWK(publicKey);jwk.kid='integration';jwk.alg='RS256';
 const keys=jose.createLocalJWKSet({keys:[jwk]});const now=Date.now(),sec=Math.floor(now/1000);
 const signed=async(payload,typ)=>new jose.SignJWT(payload).setProtectedHeader({alg:'RS256',typ,kid:'integration'}).setIssuedAt(sec).setExpirationTime(sec+600).sign(privateKey);
 const access=await signed({iss:config.issuer,sub:'test-user',aud:config.audience,scope:config.scope},'at+jwt');
 let identity=await signed({iss:config.issuer,sub:'test-user',aud:config.clientId,nonce:'expected'},'JWT');
 const client=oidcClient(config,{...jose,createRemoteJWKSet:()=>keys},async()=>Response.json({access_token:access,id_token:identity,token_type:'Bearer'}),()=>now);
 assert.equal((await client.exchange('code','verifier','expected')).subject,'test-user');
 const parts=identity.split('.');parts[2]=(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);identity=parts.join('.');
 await assert.rejects(client.exchange('code','verifier','expected'),e=>e.status===401);
});
test('real PostgreSQL restricted-session identity, single-use and revocation',async t=>{
 if(!process.env.NAVYIX_TEST_BROWSER_DATABASE_URL||process.env.NAVYIX_TEST_DB_CONFIRM!=='disposable'){
  if(required)throw new Error('A migrated disposable database and restricted browser URL are required.');
  t.skip('Disposable PostgreSQL is not configured; SQL has not been executed.');return;
 }
 const pg=await dependency('pg',t);if(!pg)return;
 const pool=new pg.Pool({connectionString:process.env.NAVYIX_TEST_BROWSER_DATABASE_URL,max:3,connectionTimeoutMillis:5000});
 const store=new PostgresSessions(pool), key=hash(randomToken());
 try{
  await store.assertSafe();await store.putLogin(key,'test-only-ciphertext',Date.now()+30000);
  const results=await Promise.all([store.consumeLogin(key),store.consumeLogin(key)]);assert.equal(results.filter(Boolean).length,1);
  await store.putSession(key,'test-only-ciphertext',Date.now()+30000,Date.now()+15000);
  assert.equal((await store.getSession(key,Date.now(),900)).sealed,'test-only-ciphertext');
  await assert.rejects(pool.query('SELECT * FROM public."User" LIMIT 1'));
  await store.deleteSession(key);assert.equal(await store.getSession(key,Date.now(),900),null);
 }finally{await store.consumeLogin(key).catch(()=>{});await store.deleteSession(key).catch(()=>{});await pool.end();}
});
