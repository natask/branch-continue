/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_SOURCE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
