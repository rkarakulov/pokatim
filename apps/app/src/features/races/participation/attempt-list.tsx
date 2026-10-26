import type { MyAttempt, PendingUpload } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { formatMinskDateTime } from '@/features/devices/format';
import { meta } from '@/lib/minsk-format';

import { attemptView, pendingUploadText } from '../participation-format';

function AttemptRow({ attempt, now }: { attempt: MyAttempt; now: Date | null }) {
  const theme = useTheme();
  const view = attemptView(attempt);
  const line = meta([
    now === null ? null : formatMinskDateTime(attempt.activity.startedAt, now),
    view.source,
    view.origin,
  ]);
  return (
    <View style={[styles.row, { borderTopColor: theme.border.subtle }]}>
      <View style={styles.head}>
        <Pill label={view.status} tone={view.tone} />
        {view.best ? <Pill label={t('races.attempt.best')} tone="accent" /> : null}
      </View>
      {view.time ? (
        <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
      ) : null}
      {line ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{line}</Text>
      ) : null}
      {view.detail ? (
        <Text style={[textStyle('body'), { color: theme.text.primary }]}>{view.detail}</Text>
      ) : null}
    </View>
  );
}

/**
 * Свои попытки (новые сверху, как прислал сервер): статус, время сегмента и «Лучший» у засчитанной, причина отказа,
 * подсказка сбоя; файлы, загруженные в гонку и ещё не ставшие попыткой, — «Файл обрабатывается…» / «Файл не принят».
 */
export function AttemptList({
  attempts,
  pendingUploads,
  now,
}: {
  attempts: readonly MyAttempt[];
  pendingUploads: readonly PendingUpload[];
  now: Date | null;
}) {
  const theme = useTheme();
  const uploads = pendingUploads.flatMap((upload) => {
    const text = pendingUploadText(upload);
    return text === null ? [] : [{ id: upload.uploadId, text }];
  });
  if (attempts.length === 0 && uploads.length === 0) return null;

  return (
    <View style={styles.list}>
      {uploads.map((upload) => (
        <Text
          key={upload.id}
          style={[textStyle('body'), styles.upload, { color: theme.text.primary }]}
        >
          {upload.text}
        </Text>
      ))}
      {attempts.map((attempt) => (
        <AttemptRow key={attempt.id} attempt={attempt} now={now} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s3 },
  upload: { paddingVertical: space.s1 },
  row: { gap: space.s1, paddingTop: space.s3, borderTopWidth: stroke.hairline },
  head: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
