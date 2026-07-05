import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sprint-require-shim',
      transform(code: string, id: string) {
        if (id.includes('/sprints/') && id.includes('.test.')) {
          // Inject require() + fix CWD for sprint tests that use CJS require and relative readFileSync paths.
          // Wraps require() to try .cjs first (needed because type:module makes .js files ESM, breaking CJS require).
          // Checks the LAST path segment for extension to avoid false positives from '../' components.
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
    },
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    environmentMatchGlobs: [
      ['../../sprints/06291030-line02-profile-tabs-integration/tests/**', 'node'],
    ],
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../sprints/06291030-line02-profile-tabs-integration/tests/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'e2e/**'],
    // 棘轮门禁：2026-07-05 实测 st 54.91 / br 48.34 / fn 44.71 / ln 57.52 取 floor，
    // 只许升不许降（api 侧已有 65 门禁，dashboard 逐步向 65 收敛）
    coverage: {
      thresholds: {
        statements: 54,
        branches: 48,
        functions: 44,
        lines: 57,
      },
      reporter: ['text', 'lcov'],
    },
  },
  // 合同 ws4 测试文件名 .ts 但含 JSX；让 esbuild 按 tsx 解析所有 ts/jsx 文件
  esbuild: {
    loader: 'tsx',
    include: /\.(tsx?|jsx?)$/,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
