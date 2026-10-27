import type { AppTheme } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';

import { useMounted } from '@/lib/use-minsk-clock';

import { mapStyleUrl } from './map-style';
import { mapSupported } from './map-support';

export interface MapStyle {
  /** После монтирования: до него (SSR, первый клиентский рендер) — место карты (скелетон). */
  mounted: boolean;
  /** URL стиля по теме; `null` — env не задан или нет нативного модуля карты (Expo Go, старый dev-клиент). */
  styleUrl: string | null;
  theme: AppTheme;
}

/**
 * Гейт карты (RC-16): env стиля и модуль карты известны только после монтирования. Использует блок карты маршрута
 * каталога; перевод карты гонки — follow-up после maps-02.
 */
export function useMapStyle(): MapStyle {
  const theme = useTheme<AppTheme>();
  const mounted = useMounted();
  const styleUrl = mounted && mapSupported() ? mapStyleUrl(theme.map.basemap === 'dark') : null;
  return { mounted, styleUrl, theme };
}
