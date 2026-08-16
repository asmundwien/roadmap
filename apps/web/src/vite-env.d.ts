/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The local server's WebSocket endpoint; defaults to `ws://localhost:8790/ws`. */
  readonly VITE_ROADMAP_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
