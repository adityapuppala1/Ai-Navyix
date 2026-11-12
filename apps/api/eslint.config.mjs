import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      ecmaVersion: 'latest'
    },
    rules: {
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-constant-condition': 'error',
      'no-duplicate-case': 'error',
      'constructor-super': 'error',
      eqeqeq: ['error', 'always']
    }
  }
];
// TypeScript semantics remain enforced by the separate tsc --noEmit gate.
