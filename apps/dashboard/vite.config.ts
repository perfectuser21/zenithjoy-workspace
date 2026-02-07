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
      // N8N REST API (US N8N via Tailscale for dev)
      '/api/n8n/': {
        target: 'http://100.71.32.28:5679',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/n8n/, '/api/v1')
      },
      // N8N Webhooks (US N8N via Tailscale for dev)
      '/api/n8n-webhook/': {
        target: 'http://100.71.32.28:5679',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/n8n-webhook/, '')
      },
      // Feishu auth backend (US server)
      '/api/feishu-login': {
        target: 'http://100.71.32.28:3002',
        changeOrigin: true,
      },
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
