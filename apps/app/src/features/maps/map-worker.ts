/**
 * Путь web-воркера `maplibre-gl` 6 на собственном origin: сам он ищет воркер рядом с модулем через `import.meta.url`,
 * которого в бандле Metro нет. Файл кладёт в `public/` скрипт `scripts/copy-map-worker.ts` (`dev`, `build:web`).
 */
export const MAP_WORKER_FILE = 'maplibre-gl-worker.mjs';
