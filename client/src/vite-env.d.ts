/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origen del servidor de sockets. Vacío = mismo origen que el front. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
