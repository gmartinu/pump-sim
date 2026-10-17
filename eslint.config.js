import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'build/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use o relógio injetável (Clock).' },
        { object: 'Math', property: 'random', message: 'Use um PRNG com semente (ex.: InjetorFalhas) para manter o determinismo.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'new Date() lê o relógio do sistema: use o Clock injetável.' },
      ],
    },
  },
  {
    // Web UI (ui/): plain browser ES modules, no build step. It only renders what the control API returns.
    files: ['ui/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: Object.fromEntries(
        ['window', 'document', 'location', 'navigator', 'localStorage', 'matchMedia', 'performance', 'WebSocket', 'fetch', 'URL', 'URLSearchParams', 'Blob', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console'].map((g) => [g, 'readonly']),
      ),
    },
  },
  {
    // Project homepage (site/): classic browser scripts, no build step, no network.
    files: ['site/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: Object.fromEntries(
        ['window', 'document', 'navigator', 'setTimeout', 'setInterval', 'clearInterval'].map((g) => [g, 'readonly']),
      ),
    },
  },
  {
    // Build scripts run on Node, outside the simulator.
    files: ['tools/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { process: 'readonly', fetch: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', WebSocket: 'readonly' } },
  },
  {
    files: ['src/core/clock.ts', 'src/cli.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-restricted-syntax': 'off' },
  },
);
