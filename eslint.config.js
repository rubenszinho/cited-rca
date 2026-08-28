// Flat config. Deliberately small: the quality ratchet in quality.toml owns
// complexity limits, so ESLint here only catches correctness classes that a
// type checker and a metrics tool both miss.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'fixtures/cases', 'results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
);
