import type { TrackUpload } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { uploadStatus } from './format';
import { UploadProgress } from './upload-progress';
import { useTrackFileUpload } from './use-track-file-upload';

interface TrackUploadBlockProps {
  /** загрузки из списка (опрос): статус только что отправленного файла берём оттуда */
  uploads: readonly TrackUpload[] | undefined;
}

/**
 * «Загрузить файл»: подсказка «FIT или GPX, до 16 МБ», системный выбор, отправка с процентом и «Отменить», затем
 * статус обработки из опроса списка («Обрабатываем…» → «Готово» / причина). Отказ pre-check или сервера — баннер.
 */
export function TrackUploadBlock({ uploads }: TrackUploadBlockProps) {
  const theme = useTheme();
  const { state, choose, cancel } = useTrackFileUpload();
  const meta = [textStyle('meta'), { color: theme.text.secondary }];

  const sent =
    state.phase === 'sent'
      ? (uploads?.find((item) => item.id === state.upload.id) ?? state.upload)
      : undefined;

  return (
    <View style={styles.block}>
      <Text style={meta}>{t('tracks.upload.hint')}</Text>
      {state.phase === 'uploading' ? (
        <UploadProgress name={state.name} progress={state.progress} onCancel={cancel} />
      ) : (
        <Button label={t('tracks.upload.action')} onPress={() => void choose()} />
      )}
      {state.phase === 'failed' ? <Banner tone="error" message={state.message} /> : null}
      {state.phase === 'sent' && sent ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[textStyle('body'), { color: theme.text.primary }]}
        >
          {t('tracks.upload.sent', { name: state.name, status: uploadStatus(sent).label })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
});
