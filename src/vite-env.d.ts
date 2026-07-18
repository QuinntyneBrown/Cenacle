/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROOM_ORIGIN?: string;
  readonly VITE_WT_CERT_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
