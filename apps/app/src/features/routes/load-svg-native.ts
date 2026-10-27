/**
 * Ленивая загрузка `react-native-svg` (только native, после `svgSupported()`): пакет зовёт
 * `TurboModuleRegistry.getEnforcing` при импорте — статический импорт уронил бы карточку маршрута в старом dev-клиенте.
 * Отдельный модуль — точка подмены в jest. Web рисует inline `<svg>` (`profile-chart.web.tsx`) — пакет не нужен.
 */
export const loadSvgNative = () => import('react-native-svg');
