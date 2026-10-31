import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';

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
      <ProgressBar value={percent} max={100} accessibilityLabel={name} />
      <View style={styles.action}>
        <TextAction label={t('tracks.upload.cancel')} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { gap: space.s2 },
  action: { alignItems: 'flex-start' },
});
