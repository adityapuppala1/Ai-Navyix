import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/workflow.mjs';
import { STORAGE_KEY, readWorkspace, saveWorkspace, emptyWorkspace } from '../src/storage.mjs';
const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
test('empty store opens without fabricated projects', () => assert.equal(readWorkspace(memory()).projects.length, 0));
test('save and reopen preserves project records', () => { const store = memory(), p = createProject({ name: 'Portal', goal: 'Build safely', owner: 'QA' }); saveWorkspace(store, { ...emptyWorkspace(), projects: [p] }, 0); assert.deepEqual(readWorkspace(store).projects[0], p); });
test('stale tab cannot overwrite a newer workspace', () => { const store = memory(); saveWorkspace(store, emptyWorkspace(), 0); assert.throws(() => saveWorkspace(store, emptyWorkspace(), 0), /another tab/); });
test('corrupt JSON is preserved and reported', () => { const store = memory(); store.setItem(STORAGE_KEY, 'broken'); assert.throws(() => readWorkspace(store), /not been overwritten/); assert.equal(store.getItem(STORAGE_KEY), 'broken'); });
test('storage quota failure does not report a successful save', () => { const store = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }; assert.throws(() => saveWorkspace(store, emptyWorkspace(), 0), /Quota/); });
test('unsupported schema rejected', () => { const store = memory(); store.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99, revision: 0, projects: [] })); assert.throws(() => readWorkspace(store), /unsupported/); });
test('duplicate project identity rejected', () => { const store = memory(), p = createProject({ name: 'Portal', goal: 'Build safely', owner: 'QA' }); store.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, revision: 0, projects: [p, p] })); assert.throws(() => readWorkspace(store), /invalid/); });

test('corrupt nested records fail safely instead of crashing the renderer', () => { const store = memory(), p = createProject({ name: 'Portal', goal: 'Build safely', owner: 'QA' }); p.designs = [null]; store.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, revision: 0, projects: [p] })); assert.throws(() => readWorkspace(store), /invalid/); });
