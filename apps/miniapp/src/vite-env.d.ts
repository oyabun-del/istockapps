/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when the Mini App is hosted separately from the server. Empty = same origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** apps/miniapp/package.json version, injected by vite.config.ts `define`. */
declare const __APP_VERSION__: string;
