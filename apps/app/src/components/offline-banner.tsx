import { t } from '@pokatim/i18n';
import { Banner } from '@rkarakulov/ui';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useIsOnline } from '@/lib/use-minsk-clock';

export interface OfflineBannerProps {
  /** На экране уже показаны данные: без них «Нет соединения» показывает `AsyncContent` на месте данных. */
  hasData: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Без сети при показанных данных (§4.12) — баннер «Нет соединения» над данными: запросы TanStack Query стоят на паузе
 * и возобновятся сами, когда сеть вернётся (`onlineManager`). Главная, вкладка «Гонки», карточка гонки, сезон.
 */
export function OfflineBanner({ hasData, style }: OfflineBannerProps) {
  const online = useIsOnline();
  if (online || !hasData) return null;
  return (
    <View style={style}>
      <Banner tone="warning" title={t('state.errorTitle')} message={t('offline.message')} />
    </View>
  );
}
