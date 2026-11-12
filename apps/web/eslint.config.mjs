import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  // Lint canonical sources, not duplicated generated workbench or Next output.
  { ignores: ['.next/**', 'dist/**', 'coverage/**', 'public/workbench/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript')
];
