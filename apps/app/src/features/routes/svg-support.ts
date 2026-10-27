import { TurboModuleRegistry } from 'react-native';

/**
 * Нативные модули `react-native-svg` 15, которые пакет требует уже при импорте (`TurboModuleRegistry.getEnforcing`).
 */
const REQUIRED_MODULES = ['RNSVGSvgViewModule', 'RNSVGRenderableModule'] as const;

/**
 * SVG доступен на устройстве (routes-04 G2): в dev-клиенте, собранном до routes-04, модуля нет — импорт пакета бросил
 * бы. Нет — график профиля рисуется столбиками `View` (как routes-03). Образец — `features/maps/map-support.ts`.
 */
export function svgSupported(): boolean {
  return REQUIRED_MODULES.every((name) => TurboModuleRegistry.get(name) !== null);
}
