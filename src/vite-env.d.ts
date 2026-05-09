/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_SOURCE_PATH?: string
  readonly VITE_MASTER_ORCH_APP_ID?: string
  readonly VITE_MASTER_ORCH_URL?: string
  readonly VITE_MASTER_ORCH_DEPLOYMENT_ID?: string
  readonly VITE_MASTER_ORCH_TOKEN?: string
  readonly VITE_MASTER_ORCH_POLL_MS?: string
  readonly VITE_MASTER_ORCH_BASE_BRANCH?: string
  readonly VITE_MASTER_ORCH_TARGET_BRANCH?: string
  readonly VITE_MASTER_ORCH_APPLY_TO?: string
  readonly VITE_MASTER_ORCH_DISABLED?: string
  readonly VITE_MASTER_ORCH_AGENTATION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
