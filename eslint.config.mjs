import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundaries are enforced here rather than left to review.
 * Two rules carry real weight:
 *   - `packages/domain` must stay pure, so it may not reach for I/O, frameworks or the clock.
 *   - Features may only be imported through their public index, never file by file.
 */
const DOMAIN_PURITY = {
  files: ['packages/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@magic/db', '@magic/db/*'], message: 'domain is pure: no persistence imports.' },
          { group: ['@nestjs/*'], message: 'domain is pure: no framework imports.' },
          { group: ['@magic/stripe-client*'], message: 'domain is pure: no integration imports.' },
          { group: ['bullmq', 'ioredis', 'stripe', 'pino'], message: 'domain is pure: no I/O libraries.' },
          {
            group: ['node:*', '!node:crypto'],
            message: 'domain is pure: node:crypto hashing is the only Node built-in allowed.',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'domain is pure: no I/O.' },
    ],

    /*
     * The ban is on reading the clock, not on the Date namespace. `Date.parse` over a timestamp
     * that came from the snapshot is pure and is exactly how maturity windows are computed;
     * `Date.now()` and a zero-argument `new Date()` are what make a run unreproducible.
     */
    'no-restricted-syntax': [
      'error',
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'Determinism: rules read snapshot.asOf, never the wall clock.',
      },
      {
        selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
        message: 'Determinism: rules read snapshot.asOf, never the wall clock.',
      },
      {
        selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
        message: 'Determinism: no randomness inside domain code.',
      },
      {
        selector: "CallExpression[callee.property.name='randomUUID']",
        message: 'Determinism: identifiers are derived from their inputs, not generated.',
      },
    ],
  },
};

const FEATURE_BOUNDARIES = {
  files: ['apps/web/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/features/*/*'],
            message: 'Import a feature through its index barrel, never a file inside it.',
          },
        ],
      },
    ],
    'react/no-danger': 'off',
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  DOMAIN_PURITY,
  FEATURE_BOUNDARIES,

  /*
   * NestJS resolves dependencies from decorator metadata, which is emitted from the constructor
   * parameter types. Rewriting those imports as `import type` erases them at compile time and
   * the container then has nothing to inject, so this rule cannot apply to decorated files.
   */
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
);
