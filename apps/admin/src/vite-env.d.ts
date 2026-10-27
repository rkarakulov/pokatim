/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin web приложения для «Забыли пароль?» в `pnpm dev`; на стенде и в проде не задаётся (тот же origin). */
  readonly VITE_APP_WEB_URL?: string;
  /**
   * URL стиля MapLibre для карты маршрута (routes-05, ADR-0014; тот же OpenFreeMap, что у приложения). Только светлый:
   * панель только светлая. Не задан — карты нет, превью линии (`LinePreview`).
   */
  readonly VITE_MAP_STYLE_LIGHT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
