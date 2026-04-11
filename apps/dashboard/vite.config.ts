import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
    dedupe: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'axios', 'recharts', '@hello-pangea/dnd',
    ],
  },
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'axios', 'recharts', '@hello-pangea/dnd',
    ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo-color.png', 'logo-white.png'],
      manifest: {
        name: '悦升云端',
        short_name: 'ZenithJoy',
        description: '内部运营中台 - 统一管理多平台社媒运营数据',
        theme_color: '#1e3a8a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/logo-color.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/logo-white.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome'
          }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/dashboard\.zenjoymedia\.media:.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  server: {
    port: 3001,
    proxy: {
      // Works Management API - 字段管理
      '/api/fields': {
        target: 'http://localhost:5200/api',
        changeOrigin: true,
      },
      // Works Management API - 作品管理
      '/api/works': {
        target: 'http://localhost:5200/api',
        changeOrigin: true,
      },
      // Pipeline API — zenithjoy 数据所有权
      '/api/pipeline': {
        target: 'http://localhost:5200',
        changeOrigin: true,
      },
      // Brain API — 内容工厂配置（content-types）等
      '/api/brain': {
        target: 'http://localhost:5221',
        changeOrigin: true,
      },
      // 内容图片代理 — ~/claude-output/images/
      '/content-images': {
        target: 'http://localhost:9998',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/content-images/, '/images'),
      },
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
