import { t } from '@pokatim/i18n';

/**
 * Строки интерфейса `maplibre-gl` (опция `locale`, routes-04b RC-1): подпись холста (`aria-label`). Подсказка колеса
 * — своя (`guardWheelZoom`, routes-04c): кооперативный режим выключен. Вызывается при создании карты (эффект, клиент).
 */
export function mapLocale(): Record<string, string> {
  return {
    'Map.Title': t('maps.canvas'),
  };
}
