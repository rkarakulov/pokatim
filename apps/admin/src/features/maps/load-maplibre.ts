import type * as MapLibre from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

let workerSet = false;

/**
 * Ленивая загрузка `maplibre-gl` и его CSS (routes-05, RC-13): ~1,1 МБ и ~70 КБ — отдельный async-чанк, в первый
 * чанк панели не попадает (статического импорта нет). Воркер — свой ассет Vite на том же origin (`?url`, CSP
 * `worker-src 'self' blob:`): сам MapLibre ищет его по `import.meta.url` чанка, а такой файл Vite не копирует.
 * Отдельный модуль — точка подмены в тестах (jsdom без WebGL).
 */
export async function loadMaplibre(): Promise<typeof MapLibre> {
  const [maplibre] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  if (!workerSet) {
    maplibre.setWorkerUrl(workerUrl);
    workerSet = true;
  }
  return maplibre;
}
