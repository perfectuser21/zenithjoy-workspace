// Workspace root vitest config for sprint tests
// CJS format avoids needing vitest in root node_modules for config loading
const path = require('path');

module.exports = {
  test: {
    root: path.resolve(__dirname),
    environment: 'node',
    include: ['sprints/**/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['node_modules'],
    globalSetup: ['./sprints/sprint-global-setup.cjs'],
    setupFiles: ['./sprints/sprint-setup.mjs'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './apps/dashboard/src'),
    },
  },
};
