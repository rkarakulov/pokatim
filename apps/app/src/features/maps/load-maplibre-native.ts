/**
 * Ленивая загрузка `@maplibre/maplibre-react-native` (только native, после `mapSupported()`): пакет зовёт
 * `TurboModuleRegistry.getEnforcing` при импорте — статический импорт уронил бы карточку гонки в Expo Go и старом
 * dev-клиенте. Отдельный модуль — точка подмены в jest.
 */
export const loadMapLibreNative = () => import('@maplibre/maplibre-react-native');
