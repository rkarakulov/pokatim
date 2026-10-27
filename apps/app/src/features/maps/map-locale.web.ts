import { t } from '@pokatim/i18n';

/**
 * Строки интерфейса `maplibre-gl` (опция `locale`, routes-04b RC-1): подпись холста (`aria-label`) и подсказка
 * кооперативных жестов. Вызывается при создании карты (эффект, клиент).
 */
export function mapLocale(): Record<string, string> {
  return {
    'Map.Title': t('maps.canvas'),
    'CooperativeGesturesHandler.WindowsHelpText': t('maps.gestures.wheel'),
    'CooperativeGesturesHandler.MacHelpText': t('maps.gestures.wheelMac'),
    'CooperativeGesturesHandler.MobileHelpText': t('maps.gestures.touch'),
  };
}
