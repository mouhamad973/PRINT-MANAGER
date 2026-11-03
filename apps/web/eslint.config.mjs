import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const config = [
  { ignores: ['.next/**', 'next-env.d.ts', 'coverage/**'] },
  ...nextVitals,
  ...nextTypescript,
  prettier,
];

export default config;
