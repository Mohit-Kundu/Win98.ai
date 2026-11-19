import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const vfsPatterns = ['**/vfs', '**/vfs/**'];

const restrict = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: patterns.map((group) => ({ group: [group], message })) }],
});

// Secret-leak guard for browser code.
const noSecretInSrc = {
  'no-restricted-syntax': [
    'error',
    { selector: 'Literal[value=/GEMINI_API_KEY/]', message: 'GEMINI_API_KEY must never be referenced under src/.' },
    { selector: 'TemplateElement[value.raw=/GEMINI_API_KEY/]', message: 'GEMINI_API_KEY must never be referenced under src/.' },
    { selector: 'Identifier[name=/GEMINI_API_KEY/]', message: 'GEMINI_API_KEY must never be referenced under src/.' },
    { selector: 'Literal[value=/VITE_/]', message: 'Do not use VITE_* variables for secrets.' },
    { selector: 'MemberExpression[property.name=/^VITE_/]', message: 'Do not use VITE_* variables for secrets.' },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'test-results', 'playwright-report', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  { files: ['src/**/*.{ts,tsx}'], rules: noSecretInSrc },
  // apps: no direct VFS access
  {
    files: ['src/apps/**/*.{ts,tsx}'],
    rules: {
      ...noSecretInSrc,
      ...restrict(vfsPatterns, 'Apps must use src/actions, not src/vfs.'),
    },
  },
  // ai tools: actions only (no VFS)
  {
    files: ['src/ai/tools/**/*.ts'],
    rules: {
      ...noSecretInSrc,
      ...restrict(vfsPatterns, 'AI tools must use src/actions, not src/vfs.'),
    },
  },
  // other src layers except actions and vfs: no VFS
  {
    files: ['src/desktop/**/*.{ts,tsx}', 'src/store/**/*.ts', 'src/ui/**/*.{ts,tsx}', 'src/ai/*.{ts,tsx}'],
    rules: {
      ...noSecretInSrc,
      ...restrict(vfsPatterns, 'Only src/actions may import src/vfs.'),
    },
  },
  // server: never import src/
  {
    files: ['server/**/*.ts'],
    rules: restrict(['**/src', '**/src/**'], 'server/** must not import src/**. Share code through shared/**.'),
  },
);
