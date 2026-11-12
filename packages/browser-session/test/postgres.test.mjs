import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PostgresSessions } from '../src/postgres.mjs';
const safe = {name:'navyix_browser',elevated:false,business_access:false,inherited_roles:false,owns_database:false,can_create:false,owns_schema:false,owns_table:false,security_definer_access:false};
for(const flag of ['elevated','business_access','inherited_roles','owns_database','can_create','owns_schema','owns_table','security_definer_access'])test(`startup denies database role ${flag}`,async()=>{
 const store=new PostgresSessions({query:async()=>({rows:[{...safe,[flag]:true}]})});await assert.rejects(store.assertSafe());
});
test('startup rejects API/admin identity',async()=>{const store=new PostgresSessions({query:async()=>({rows:[{...safe,name:'navyix_app'}]})});await assert.rejects(store.assertSafe());});
test('restricted identity contract succeeds',async()=>{const calls=[];const store=new PostgresSessions({query:async(q)=>{calls.push(q);return{rows:[safe]}}});await store.assertSafe();assert.equal(calls.length,3);});
test('all record operations bind values and atomically consume login transactions',async()=>{
 const calls=[], key='f'.repeat(64);const store=new PostgresSessions({query:async(sql,values)=>{calls.push({sql,values});return{rows:[]}}});
 await store.putLogin(key,"sealed'); DROP TABLE users;--",Date.now()+10000);await store.consumeLogin(key);await store.putSession(key,'sealed',Date.now()+20000,Date.now()+10000);await store.getSession(key,Date.now(),900);await store.deleteSession(key);await store.cleanup();
 assert.ok(calls.every(c=>!c.sql.includes(key)));assert.match(calls[1].sql,/DELETE .* RETURNING/);assert.equal(calls[0].values[1],"sealed'); DROP TABLE users;--");assert.match(calls[3].sql,/expires_at > \$2 AND idle_until > \$2/);
});
test('migration is additive with no business table mutation and no default password',async()=>{
 const text=await readFile(new URL('../../../apps/api/prisma/migrations/202611110002_browser_sessions/migration.sql',import.meta.url),'utf8');
 assert.match(text,/CREATE SCHEMA browser_auth/);assert.match(text,/REVOKE ALL ON SCHEMA browser_auth FROM PUBLIC/);assert.match(text,/GRANT UPDATE\(idle_until\)/);
 assert.ok(!/DROP TABLE|TRUNCATE|ALTER TABLE public\./i.test(text));assert.ok(!/PASSWORD\s+'/i.test(text));
});
