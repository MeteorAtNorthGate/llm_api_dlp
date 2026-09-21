import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Core `no-unused-vars` cannot see JSX, so every imported component looks
      // unused. This is the minimal fix — we deliberately do not pull in
      // plugin-react's full recommended set.
      'react/jsx-uses-vars': 'error',
      // Allow intentionally-unused args/vars when prefixed with an underscore.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Vite / Tailwind configs run in Node, not the browser.
  {
    files: ['vite.config.js', 'postcss.config.js', 'tailwind.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Vitest specs.
  {
    files: ['**/*.{test,spec}.{js,jsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
];
