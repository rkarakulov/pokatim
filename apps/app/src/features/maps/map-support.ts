import { TurboModuleRegistry } from 'react-native';

/**
 * Нативные модули `@maplibre/maplibre-react-native` 11.5, которые пакет требует уже при импорте
 * (`TurboModuleRegistry.getEnforcing`): первым — камера (`Camera` открывает `index`), главный — карта.
 */
const REQUIRED_MODULES = ['MLRNCameraModule', 'MLRNMapViewModule'] as const;

/**
 * Карта доступна на устройстве: в Expo Go и в dev-клиенте, собранном до maps-01, нативного модуля нет — импорт пакета
 * бросил бы. Нет — как env стиля не задан: блока карты нет, карточка работает.
 */
export function mapSupported(): boolean {
  return REQUIRED_MODULES.every((name) => TurboModuleRegistry.get(name) !== null);
}
