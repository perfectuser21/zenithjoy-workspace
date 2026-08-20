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
    // sprint 测试跑在**同一个真 Postgres** 上（合同禁 mock 边要求真库真验），
    // 文件级并行会让 suite 之间互相污染：路③ 有一条用例故意把 zenithjoy.tenant_members
    // 临时改名来制造"成员表不可达"，那几百毫秒里任何并发 suite 的鉴权都会拿到 503。
    // 实测：并行 19/20（那一条红在 503），串行 20/20。共享真库下并行是假设不成立，不是慢。
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './apps/dashboard/src'),
    },
  },
};
