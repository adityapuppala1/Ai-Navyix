import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccess, ROLES, ACTIONS} from '../src/access.mjs';

const principal={id:'user-a'};
const membership={userId:'user-a',orgId:'org-a',role:'VIEWER',active:true};
const projectMembership={userId:'user-a',orgId:'org-a',projectId:'project-a',active:true};
const check=(overrides={})=>canAccess({principal,membership,orgId:'org-a',action:'project:read',projectId:'project-a',projectMembership,...overrides});

test('viewer can read own project with trusted active membership',()=>assert.equal(check(),true));
test('viewer cannot modify project',()=>assert.equal(check({action:'project:write'}),false));
test('missing principal is denied',()=>assert.equal(check({principal:null}),false));
test('cross-organization request is denied',()=>assert.equal(check({orgId:'org-b'}),false));
test('cross-project request is denied',()=>assert.equal(check({projectId:'project-b'}),false));
test('inactive membership is denied',()=>assert.equal(check({membership:{...membership,active:false}}),false));
test('wrong principal is denied',()=>assert.equal(check({principal:{id:'user-b'}}),false));
test('unknown action is denied',()=>assert.equal(check({action:'superuser'}),false));
test('unknown role is denied',()=>assert.equal(check({membership:{...membership,role:'ROOT'}}),false));
test('project access requires explicit project membership',()=>assert.equal(check({projectMembership:null}),false));
test('inactive project membership is denied',()=>assert.equal(check({projectMembership:{...projectMembership,active:false}}),false));
test('reviewer can review own project',()=>assert.equal(check({membership:{...membership,role:'REVIEWER'},action:'assessment:review'}),true));
test('contributor cannot grant AI source access',()=>assert.equal(check({membership:{...membership,role:'CONTRIBUTOR'},action:'ai:grant'}),false));
test('owner can grant AI source access',()=>assert.equal(check({membership:{...membership,role:'OWNER'},action:'ai:grant'}),true));
test('permissions are declared',()=>{assert.ok(ROLES.includes('OWNER'));assert.ok(ACTIONS.includes('evidence:read'));});
