import test from 'node:test';
import assert from 'node:assert/strict';
import { options, plan, preflight, execute } from '../../../scripts/verify-workspace.mjs';

test('default verification never starts processes',()=>{
  let count=0;const result=execute('/repo',options([]),{checks:[{name:'Synthetic prerequisites',passed:true}],run:()=>count++});
  assert.equal(count,0);assert.equal(result.scope,'prerequisites-only');assert.equal(result.status,'prerequisites-passed');
});
test('missing prerequisites block full verification without executing a command',()=>{
  const result=execute('/repo',options(['--full']),{checks:[{name:'Lockfile',passed:false}],run:()=>{throw new Error('Must not run');}});
  assert.equal(result.status,'blocked');assert.equal(result.steps.length,0);
});
test('strict integration requires explicit disposable-database confirmation',()=>{
  const result=execute('/repo',options(['--integration']),{checks:[],env:{},run:()=>{throw new Error('Must not run');}});
  assert.equal(result.status,'blocked');assert.equal(result.checks.at(-1).passed,false);
});
test('plan never installs packages, migrates databases, dispatches CI, pushes or deploys',()=>{
  for(const step of plan(options(['--integration']))) assert.doesNotMatch([step.command,...step.args].join(' '),/install|migrate|db:push|deploy|workflow|git push/);
});
test('strict integration sets the real-test requirement rather than allowing silent skips',()=>{
  const p=plan(options(['--integration']));assert.equal(p.at(-2).env.NAVYIX_REQUIRE_INTEGRATION,'1');assert.ok(p.at(-1).args.includes('--integration'));
});
test('command failure stops subsequent checks and is never reported as pass',()=>{
  let count=0;const result=execute('/repo',options(['--full']),{checks:[],run:()=>({status:++count===2?1:0})});
  assert.equal(count,2);assert.equal(result.status,'failed');assert.equal(result.steps.at(-1).status,'failed');
});
test('successful requested checks still list unverified external acceptance gates',()=>{
  const result=execute('/repo',options(['--integration']),{checks:[],env:{NAVYIX_TEST_DB_CONFIRM:'disposable'},run:()=>({status:0})});
  assert.equal(result.status,'requested-local-checks-passed');assert.equal(result.steps.length,8);assert.ok(result.remaining.includes('Live provider login'));
});
test('unknown flags and missing report path are rejected',()=>{
  assert.throws(()=>options(['--deploy']));assert.throws(()=>options(['--report']));assert.throws(()=>options(['--report','--full']));
});
test('preflight reports missing dependencies and old Node honestly',()=>{
  const checks=preflight('/repo',{nodeVersion:'20.0.0',exists:()=>false,dependency:()=>false});assert.ok(checks.every(c=>!c.passed));
});
