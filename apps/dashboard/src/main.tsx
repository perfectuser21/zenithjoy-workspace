import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 分钟
    },
  },
})

// 部署即更新（2026-06-25）：替换掉旧的「写死 APP_VERSION + 手动注销 SW」缓存破除法
// （没人记得 bump 版本号，运营被旧 SW 缓存挡着看不到新前端）。
// 改用 vite-plugin-pwa 的 registerSW：配合 vite.config 的 skipWaiting/clientsClaim/autoUpdate，
// 一旦检测到新版 SW（每次部署 hash 变了就有），立刻 updateSW(true) 接管并刷新，用户刷新即拿到新前端。
if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // 有新版本就立刻接管并整页刷新（内部中台，无需弹窗征求用户同意）
      void updateSW(true)
    },
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
