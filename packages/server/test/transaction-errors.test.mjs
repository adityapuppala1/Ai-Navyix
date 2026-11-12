import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransactionConflict } from '../src/transaction-errors.mjs';
for (const code of ['P2034','P2002','40001','40P01','23505'])
  test(`direct conflict code ${code}`, () => assert.equal(isTransactionConflict({ code }), true));
for (const code of ['40001','40P01','23505'])
  test(`raw-query wrapper preserves SQLSTATE ${code}`, () => assert.equal(isTransactionConflict({ code: 'P2010', meta: { code, message: 'private DB detail' } }), true));
for (const [name, error] of [
  ['null', null], ['undefined', undefined], ['text', '40001'], ['no code', {}],
  ['unrelated Prisma code', { code: 'P1001' }], ['missing metadata', { code: 'P2010' }],
  ['permission denial', { code: 'P2010', meta: { code: '42501' } }],
  ['bad SQL', { code: 'P2010', meta: { code: '42601' } }],
  ['nested code without raw wrapper', { code: 'UNKNOWN', meta: { code: '40001' } }],
  ['message substring', { message: '40001 P2034 23505' }],
  ['number', { code: 40001 }]
]) test(`does not misclassify ${name}`, () => assert.equal(isTransactionConflict(error), false));
