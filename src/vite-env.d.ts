/// <reference types="vite-plus/client" />
declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_DEBUG: string;
  readonly VITE_MOCK_EXTENSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
