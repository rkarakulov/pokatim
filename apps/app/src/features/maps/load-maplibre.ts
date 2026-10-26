/**
 * Динамическая загрузка `maplibre-gl` (только web, после монтирования — ADR-0014 п. 5): отдельный чанк, в серверный
 * бандл и первый чанк не попадает. Отдельный модуль — точка подмены в jest (без `--experimental-vm-modules`
 * динамический `import()` там не работает).
 */
export const loadMaplibre = () => import('maplibre-gl');
