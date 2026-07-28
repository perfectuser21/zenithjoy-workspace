import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // 宿主经 apps/agent-panel-host/MainWindow.xaml.cs 的 SetVirtualHostNameToFolderMapping
  // 把 dist/ 映射成虚拟 https 域名加载（file:// 直接加载 ES module 脚本会被 Chromium 的模块
  // CORS 限制静默拦截，xian-rog 真机验证实测复现，已改用虚拟host方案规避）。base:'/' 生成的
  // 绝对路径 script src 在虚拟host的子路径场景下同样脆弱，统一用相对路径更稳妥。
  base: './',
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
