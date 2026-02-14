/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_N8N_WEBHOOK_BASE: string
  readonly VITE_N8N_API_KEY?: string
  readonly VITE_FEISHU_APP_ID: string
  readonly VITE_FEISHU_REDIRECT_URI: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
