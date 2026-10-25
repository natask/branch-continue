/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_SOURCE_PATH?: string
  readonly VITE_GCP_PROJECT_ID?: string
  readonly VITE_GCP_LOCATION?: string
  readonly VITE_BRANCH_CONTINUE_MOBILE_OTA_URL?: string
  readonly VITE_BRANCH_CONTINUE_MOBILE_OTA_RELEASE_ID?: string
  readonly VITE_AGENT_SWITCHBOARD_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
