import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // 排除 Playwright E2E 目录（由 npm run e2e 运行）
    exclude: ['node_modules', 'dist', 'e2e/**'],
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
