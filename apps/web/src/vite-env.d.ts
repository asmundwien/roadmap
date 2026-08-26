/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The local server's HTTP origin; defaults to `http://localhost:8790`. */
  readonly VITE_ROADMAP_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
