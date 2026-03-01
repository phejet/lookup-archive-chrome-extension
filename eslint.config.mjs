import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/', 'eslint.config.mjs'],
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        DOMParser: 'readonly',
        CSS: 'readonly',
        AbortSignal: 'readonly',
        Infinity: 'readonly',
        performance: 'readonly',
        location: 'readonly',
        Promise: 'readonly',
        Set: 'readonly',
        Map: 'readonly',
        // Chrome extension
        chrome: 'readonly',
        // Conditional exports
        module: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        // Vitest globals
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        // Node/jsdom globals
        module: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
];
