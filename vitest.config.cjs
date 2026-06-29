// Workspace root vitest config for sprint tests
// Used when `npx vitest` is run from workspace root (vitest in root devDependencies)
const path = require('path');

const sprintRequireShim = {
  name: 'sprint-require-shim',
  transform(code, id) {
    if (id.includes('/sprints/') && id.includes('.test.')) {
      // Inject require() + fix CWD. Try .cjs before .js to handle type:module packages.
      const shim = [
        "import { createRequire as __createRequire } from 'module';",
        "import { fileURLToPath as __fileURLToPath } from 'url';",
        "import { resolve as __resolve } from 'path';",
        "const __nr = __createRequire(import.meta.url);",
        "const require = (id) => { const last = id.slice(id.lastIndexOf('/') + 1); if (!last.includes('.')) { try { return __nr(id + '.cjs'); } catch {} } return __nr(id); };",
        "process.chdir(__resolve(__fileURLToPath(import.meta.url), '..', '..', '..', '..'));",
        '',
      ].join('\n');
      return { code: shim + code, map: null };
    }
  },
};

module.exports = {
  plugins: [sprintRequireShim],
  test: {
    root: path.resolve(__dirname),
    environment: 'node',
    include: ['sprints/**/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['node_modules'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './apps/dashboard/src'),
    },
  },
};
