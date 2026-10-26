import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Отправка файла заезда: «Загружаем {имя}: N%», полоса `progressbar` и «Отменить». Общая разметка «Устройств» и
 * загрузки в гонку (race-results-04).
 */
export function UploadProgress({
  name,
  progress,
  onCancel,
}: {
  name: string;
  /** доля 0…1 */
  progress: number;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const percent = Math.round(progress * 100);
  return (
    <View style={styles.progress}>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {t('tracks.upload.progress', { name, percent })}
      </Text>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={name}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={[styles.track, { backgroundColor: theme.border.subtle }]}
      >
        <View
          style={[styles.fill, { backgroundColor: theme.text.primary, width: `${percent}%` }]}
        />
      </View>
      <View style={styles.action}>
        <TextAction label={t('tracks.upload.cancel')} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { gap: space.s2 },
  track: { height: stroke.indicator, alignSelf: 'stretch' },
  fill: { height: stroke.indicator },
  action: { alignItems: 'flex-start' },
});
