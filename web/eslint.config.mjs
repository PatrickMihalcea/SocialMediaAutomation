import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // .next-dev is the dev server's build directory (see distDir in next.config),
  // and .venv-audio holds the Python beat analyser — between them they carry
  // thousands of bundled .js files that buried the project's own findings.
  {
    ignores: [
      '.next/**', '.next-dev/**', '.venv*/**', 'node_modules/**',
      'src/generated/**', 'next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Media uses short-lived signed URLs and preserves original dimensions;
      // Next Image cannot safely optimize these without proxying private bytes.
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
