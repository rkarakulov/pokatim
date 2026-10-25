/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin web приложения для «Забыли пароль?» в `pnpm dev`; на стенде и в проде не задаётся (тот же origin). */
  readonly VITE_APP_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
