import {defineConfig} from 'eslint/config';
import {defaultConfig, nodeConfig, typescriptConfig} from 'eslint-config-touch4it';

export default defineConfig([
  {ignores: ['dist/**']},
  ...defaultConfig,
  ...nodeConfig,
  ...typescriptConfig,
  {
    name: 'scripts',
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // Env vars are conventionally SCREAMING_SNAKE_CASE.
      '@typescript-eslint/naming-convention': ['error', {
        selector: 'objectLiteralProperty',
        format: null,
      }],
    },
  },
  {
    name: 'scripts/cli',
    files: ['src/**/*.ts'],
    rules: {
      // This is a CLI: a non-zero exit is how it reports failure.
      'n/no-process-exit': 'off',
      'unicorn/no-process-exit': 'off',
    },
  },
  {
    name: 'scripts/test',
    files: ['test/**/*.ts'],
    rules: {
      // Node:test's describe/it return promises that callers are not meant to await.
      '@typescript-eslint/no-floating-promises': 'off',
      // Engines.node targets consumers of dist/; tests are never published.
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
]);
