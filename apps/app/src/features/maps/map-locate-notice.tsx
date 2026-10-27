import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { MAP_FIT_PADDING } from '@pokatim/route-view';
import { Banner } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

import { locationDeniedMessage, openLocationSettings } from '@/features/location/location-settings';

import type { LocateState } from './use-locate';

/**
 * Сообщение «Моё местоположение» над картой (routes-04d, RC-14): сверху слева, левее колонки кнопок (не под шторкой
 * и не под кнопками). Отказ навсегда на native — весь баннер — ссылка в настройки ОС (паттерн `Banner onPress`
 * базы); web — текст «в настройках браузера»; ошибка — «Не удалось определить местоположение». Баннер базы
 * озвучивает срочность (`alert` / `polite`); координат в тексте нет.
 */
export function MapLocateNotice({ state }: { state: LocateState }) {
  if (state.status !== 'denied' && state.status !== 'unavailable') return null;
  const settings = state.status === 'denied' && state.canOpenSettings;
  return (
    <View testID="map-locate-notice" style={styles.area}>
      <Banner
        tone="warning"
        message={
          state.status === 'denied'
            ? t(locationDeniedMessage(state.canOpenSettings))
            : t('maps.location.unavailable')
        }
        onPress={settings ? () => void openLocationSettings() : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    position: 'absolute',
    top: space.s2,
    left: space.s2,
    // правее — колонка кнопок карты
    right: MAP_FIT_PADDING.right,
  },
});
