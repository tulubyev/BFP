/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

/** CDN origin for static data files, injected by vite.config.ts ('' = same origin). */
declare const __CDN_URL__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
