import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrorsIgnorePattern: '^_' }],
  'no-control-regex': 'off',
  'no-console': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
  'no-undef': 'error',
};

export default [
  { ignores: ['node_modules/', 'coverage/', 'dist/', '.taste-skill/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...rules,
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Plain browser scripts that are copied as they are (not bundled), e.g. public/theme-init.js (ES5, empty catch blocks).
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 5, sourceType: 'script', globals: { ...globals.browser } },
    rules: {
      ...rules,
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
      'prefer-const': 'off',
    },
  },
  {
    files: ['tests/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules,
  },
];
