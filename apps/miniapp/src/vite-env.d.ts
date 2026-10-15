/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when the Mini App is hosted separately from the server. Empty = same origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
