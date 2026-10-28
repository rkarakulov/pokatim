import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { EmptyState, TextAction } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

import { openLocationSettings } from '@/features/location/location-settings';

/**
 * Пустое состояние «Рядом» без позиции (05c): отказ, ошибка чтения, web без геолокации. Отказ навсегда на native —
 * «Открыть настройки» (настройки ОС), иначе — «Разрешить» (повторное чтение); вторая кнопка — «Выбрать город»
 * (выключить «Рядом» и вернуться к фильтру «Город»). Шапка и фильтры ленты остаются (§4.12).
 */
export function NearEmpty({
  canOpenSettings,
  onRetry,
  onChooseCity,
}: {
  canOpenSettings: boolean;
  onRetry: () => void;
  onChooseCity: () => void;
}) {
  return (
    <View testID="near-empty" style={styles.stack}>
      <EmptyState
        title={t('rides.nearEmpty.title')}
        message={t('rides.nearEmpty.message')}
        action={
          canOpenSettings
            ? { label: t('rides.nearEmpty.settings'), onPress: () => void openLocationSettings() }
            : { label: t('rides.nearEmpty.allow'), onPress: onRetry }
        }
      />
      <View style={styles.start}>
        <TextAction label={t('rides.nearEmpty.city')} onPress={onChooseCity} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
