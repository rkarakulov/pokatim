import type { TrackUpload } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, Pill, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { deviceActionErrorMessage } from './error-messages';
import { uploadMeta, uploadStatus, uploadTitle } from './format';
import { useDeleteTrackUpload } from './queries';

interface UploadRowProps {
  upload: TrackUpload;
  now: Date;
  first: boolean;
}

/** Загрузка в списке «Последние заезды»: имя или источник, старт по Минску и км, статус, «Удалить» с подтверждением. */
export function UploadRow({ upload, now, first }: UploadRowProps) {
  const theme = useTheme();
  const remove = useDeleteTrackUpload();
  const [confirming, setConfirming] = useState(false);
  const status = uploadStatus(upload);
  const meta = uploadMeta(upload, now);

  return (
    <View
      testID={`upload-${upload.id}`}
      style={[
        styles.row,
        first ? null : { borderTopColor: theme.border.subtle, ...styles.divided },
      ]}
    >
      <View style={styles.head}>
        <Text
          numberOfLines={1}
          style={[textStyle('titleSm'), { color: theme.text.primary }, styles.title]}
        >
          {uploadTitle(upload)}
        </Text>
        <Pill label={status.label} tone={status.tone} />
      </View>
      {meta ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{meta}</Text>
      ) : null}
      {confirming ? (
        <View style={styles.confirm}>
          <Text style={[textStyle('body'), { color: theme.text.primary }]}>
            {t('tracks.deleteConfirm')}
          </Text>
          {remove.isError ? (
            <Banner tone="error" message={deviceActionErrorMessage(remove.error)} />
          ) : null}
          <Button
            label={t('tracks.delete')}
            onPress={() => remove.mutate(upload.id)}
            loading={remove.isPending}
          />
          <TextAction
            label={t('devices.cancel')}
            onPress={() => {
              setConfirming(false);
              remove.reset();
            }}
            disabled={remove.isPending}
          />
        </View>
      ) : (
        <View style={styles.action}>
          <TextAction label={t('tracks.delete')} destructive onPress={() => setConfirming(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: size.rowPadding, gap: space.s2 },
  divided: { borderTopWidth: stroke.hairline },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  title: { flex: 1 },
  confirm: { gap: space.s3 },
  action: { alignItems: 'flex-start' },
});
