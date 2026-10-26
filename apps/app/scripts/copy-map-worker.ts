// Перед `expo start` / `expo export --platform web`: кладёт web-воркер `maplibre-gl` в public/ (в git не хранится).
// Карта (`src/features/maps/route-map.web.tsx`) задаёт его адрес через `setWorkerUrl`: сама библиотека ищет воркер
// по `import.meta.url`, которого в бандле Metro нет. Запуск — `pnpm dev`, `pnpm build:web` (Node, strip types).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Имя файла воркера в пакете и в public/ — то же, что `MAP_WORKER_FILE` карты (проверяет тест). */
export const WORKER_FILE = 'maplibre-gl-worker.mjs';

/** Копирует воркер из пакета в `publicDir`; возвращает путь копии. */
export function copyMapWorker(publicDir: string): string {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve('maplibre-gl/package.json');
  const target = join(publicDir, WORKER_FILE);
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(join(dirname(pkg), 'dist', WORKER_FILE), target);
  return target;
}

if (process.argv[1] === import.meta.filename) {
  copyMapWorker(join(import.meta.dirname, '..', 'public'));
}
