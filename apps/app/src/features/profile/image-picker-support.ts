import { requireOptionalNativeModule } from 'expo';

/**
 * Выбор фото доступен на устройстве (rider-profile): в dev-клиенте, собранном до `expo-image-picker`, нативного модуля
 * нет — импорт пакета бросил бы. Модули Expo — не TurboModule (`TurboModuleRegistry.get`, как у карты, их не видит):
 * проверка — `requireOptionalNativeModule` по имени модуля пакета (`ExponentImagePicker`).
 */
export const imagePickerSupported = (): boolean =>
  requireOptionalNativeModule('ExponentImagePicker') !== null;
