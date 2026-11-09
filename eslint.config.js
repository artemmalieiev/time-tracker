import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'node_modules/']),
  {
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { jsdoc },
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'angle-bracket' }],
      '@typescript-eslint/member-ordering': ['error', {
        default: { memberTypes: 'never', order: 'alphabetically' }
      }],
      // Type guards take any on purpose: they model the step from an unknown value to a known type.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'never'],
      'func-style': ['error', 'declaration'],
      'jsdoc/no-types': 'error',
      'no-restricted-syntax': ['error',
        { message: 'Use property access instead of destructuring.', selector: 'ObjectPattern' },
        { message: 'Use index access instead of destructuring.', selector: 'ArrayPattern' }
      ]
    }
  }
);
