/**
 * Ленивая загрузка `expo-sharing` (только native, после проверки `ExpoSharing`): пакет требует нативный модуль при
 * импорте — статический импорт уронил бы экран карточки в Expo Go и dev-клиенте до story-cards. Отдельный модуль —
 * точка подмены в jest.
 */
export const loadExpoSharing = () => import('expo-sharing');
