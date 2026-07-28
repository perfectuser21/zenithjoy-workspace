import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// E2E（e2e-verify.ps1 / e2e-staff-line-health-windows.yml）把 apps/api 起在 3000 端口，
// 本地开发默认 5200，因此代理目标可用 STAFF_HUB_API_TARGET 覆盖。
const apiTarget = process.env.STAFF_HUB_API_TARGET || 'http://localhost:5200';
const apiProxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: apiProxy,
  },
  // vite preview 有独立的代理配置，不继承 server.proxy —— E2E 走 preview，必须显式声明
  preview: {
    proxy: apiProxy,
  },
  build: {
    outDir: 'dist',
  },
});
