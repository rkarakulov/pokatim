import type { DisputeAgainstMe, MyDispute, MyRaceDisputes } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, Pill, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WithdrawConfirm } from '../participation/withdraw-confirm';
import {
  againstDecisionText,
  categoryLabel,
  disputeDate,
  disputeErrorText,
  disputeStatus,
  filedDecisionText,
} from './dispute-format';
import { DisputesFailure } from './dispute-screen';
import { useWithdrawDispute } from './queries';

/** Спор по моему результату: открыт — баннер, «Ответить» или «Ваш ответ отправлен»; решён — исход. */
function AgainstItem({ dispute, raceId }: { dispute: DisputeAgainstMe; raceId: string }) {
  const theme = useTheme();
  const router = useRouter();
  if (dispute.status !== 'open') {
    const decision = againstDecisionText(dispute);
    return decision ? <Banner message={decision} /> : null;
  }
  return (
    <View style={styles.stack}>
      <Banner
        tone="warning"
        message={t('disputes.against.banner', {
          category: categoryLabel(dispute.category),
          date: disputeDate(dispute.decidableBy),
        })}
      />
      {dispute.canRespond ? (
        <Button
          label={t('disputes.against.respond')}
          variant="secondary"
          onPress={() => router.push(`/races/dispute-response/${raceId}/${dispute.id}`)}
        />
      ) : dispute.response ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('disputes.against.responded')}
        </Text>
      ) : null}
    </View>
  );
}

/** Мой спор: категория, статус, исход с шаблоном; открытый — «Отозвать спор» с подтверждением. */
function FiledItem({ dispute, raceId }: { dispute: MyDispute; raceId: string }) {
  const theme = useTheme();
  const withdraw = useWithdrawDispute(raceId);
  const [confirming, setConfirming] = useState(false);
  const status = disputeStatus(dispute.status);
  const decision = filedDecisionText(dispute);

  return (
    <View style={[styles.item, { borderTopColor: theme.border.subtle }]}>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {categoryLabel(dispute.category)}
      </Text>
      <View style={styles.start}>
        <Pill label={status.label} tone={status.tone} />
      </View>
      {decision ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{decision}</Text>
      ) : null}
      {dispute.status === 'open' ? (
        confirming ? (
          <WithdrawConfirm
            pending={withdraw.isPending}
            texts={{
              title: t('disputes.mine.withdrawTitle'),
              body: t('disputes.mine.withdrawBody'),
              confirm: t('disputes.mine.withdraw'),
              keep: t('disputes.mine.withdrawCancel'),
            }}
            onConfirm={() => withdraw.mutate(dispute.id, { onSuccess: () => setConfirming(false) })}
            onClose={() => {
              withdraw.reset();
              setConfirming(false);
            }}
          />
        ) : (
          <View style={styles.start}>
            <TextAction
              label={t('disputes.mine.withdraw')}
              destructive
              onPress={() => {
                withdraw.reset();
                setConfirming(true);
              }}
            />
          </View>
        )
      ) : null}
      {withdraw.error ? <Banner tone="error" message={disputeErrorText(withdraw.error)} /> : null}
    </View>
  );
}

/**
 * Блок «Споры» на карточке гонки (§7.8): только вошедшему с заявкой и только когда споры есть — по моему результату
 * (D-51: категория, срок, ответ, исход) и мои как заявителя. Ошибка — компактный баннер с повтором.
 */
export function RaceDisputes({
  raceId,
  disputes,
}: {
  raceId: string;
  disputes: UseQueryResult<MyRaceDisputes | null>;
}) {
  const theme = useTheme();
  const data = disputes.data;
  if (data === undefined) {
    return disputes.isError ? (
      <DisputesFailure error={disputes.error} retry={() => void disputes.refetch()} />
    ) : null;
  }
  if (data === null || (data.filed.length === 0 && data.against.length === 0)) return null;

  return (
    <View testID="race-disputes" style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[textStyle('titleSm'), { color: theme.text.primary }]}
      >
        {t('disputes.title')}
      </Text>
      {data.against.map((dispute) => (
        <AgainstItem key={dispute.id} dispute={dispute} raceId={raceId} />
      ))}
      {data.filed.length > 0 ? (
        <View style={styles.stack}>
          <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
            {t('disputes.mine.title')}
          </Text>
          {data.filed.map((dispute) => (
            <FiledItem key={dispute.id} dispute={dispute} raceId={raceId} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  stack: { gap: space.s2 },
  item: { gap: space.s2, paddingTop: space.s2, borderTopWidth: stroke.hairline },
  start: { alignItems: 'flex-start' },
});
