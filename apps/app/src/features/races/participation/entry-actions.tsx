import type { MyRaceEntry } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { UploadProgress } from '@/features/devices/upload-progress';
import { useTrackFileUpload } from '@/features/devices/use-track-file-upload';
import { minskDateTime } from '@/lib/minsk-format';

import {
  addAttemptBlockReason,
  blockReasonText,
  raceActionErrorText,
  withdrawBlockReason,
} from '../participation-format';
import { useAddRaceAttempt, useWithdrawFromRace } from '../queries';
import { WithdrawConfirm } from './withdraw-confirm';

/**
 * Действия активной заявки — только по `actions` сервера: «Загрузить заезд» (файл тем же хуком, что «Устройства», затем
 * попытка `{ uploadId }`), «Выбрать свой заезд», срок загрузки; недоступно — причина попытки (F1); «Отменить участие» —
 * инлайн-подтверждение. Ошибка второго шага — баннер: файл уже принят и станет попыткой, если подходит (сервер, R2).
 */
export function EntryActions({
  entry,
  raceId,
  now,
}: {
  entry: MyRaceEntry;
  raceId: string;
  now: Date | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const addAttempt = useAddRaceAttempt(raceId);
  // отмена — здесь, а не в панели: после 409 сервер даст `canWithdraw: false`, панель уйдёт, а текст отказа останется
  const withdraw = useWithdrawFromRace(raceId);
  const upload = useTrackFileUpload({
    onUploaded: (sent) => addAttempt.mutate({ uploadId: sent.id }),
  });
  const { actions } = entry;
  const blocked = actions.canAddAttempt ? null : addAttemptBlockReason(actions);
  // D-39 / DQ (RC-4, RC-6): почему нельзя отменить участие; закрытое окно — без текста, как раньше
  const withdrawBlocked = withdrawBlockReason(actions);
  const meta = [textStyle('meta'), { color: theme.text.secondary }];
  const closes = now === null ? null : minskDateTime(entry.uploadClosesAt, now);

  const uploading = upload.state.phase === 'uploading';

  const choose = () => {
    addAttempt.reset();
    void upload.choose();
  };

  return (
    <View style={styles.actions}>
      {/* идущую отправку видно и после того, как срок загрузки истёк посреди неё */}
      {upload.state.phase === 'uploading' ? (
        <UploadProgress
          name={upload.state.name}
          progress={upload.state.progress}
          onCancel={upload.cancel}
        />
      ) : null}
      {actions.canAddAttempt ? (
        <View style={styles.stack}>
          {uploading ? null : (
            <Button
              label={t(
                entry.attempts.length === 0 ? 'races.entry.upload' : 'races.entry.uploadMore',
              )}
              variant={entry.attempts.length === 0 ? 'primary' : 'secondary'}
              loading={addAttempt.isPending}
              onPress={choose}
            />
          )}
          <Button
            label={t('races.entry.pickRide')}
            variant="secondary"
            onPress={() => router.push(`/races/pick/${raceId}`)}
          />
          {closes ? (
            <Text style={meta}>
              {t('races.entry.uploadUntil', { date: closes.date, time: closes.time })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {blocked ? <Text style={meta}>{blockReasonText(blocked)}</Text> : null}
      {upload.state.phase === 'failed' ? (
        <Banner tone="error" message={upload.state.message} />
      ) : null}
      {addAttempt.error ? (
        <Banner tone="error" message={raceActionErrorText(addAttempt.error)} />
      ) : null}
      {actions.canWithdraw ? (
        confirming ? (
          <WithdrawConfirm
            pending={withdraw.isPending}
            onConfirm={() => withdraw.mutate(undefined, { onSuccess: () => setConfirming(false) })}
            onClose={() => {
              withdraw.reset();
              setConfirming(false);
            }}
          />
        ) : (
          <View style={styles.start}>
            <TextAction
              label={t('races.entry.withdraw')}
              destructive
              onPress={() => {
                withdraw.reset();
                setConfirming(true);
              }}
            />
          </View>
        )
      ) : null}
      {withdrawBlocked ? <Text style={meta}>{withdrawBlocked}</Text> : null}
      {withdraw.error ? (
        <Banner tone="error" message={raceActionErrorText(withdraw.error)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.s3 },
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
