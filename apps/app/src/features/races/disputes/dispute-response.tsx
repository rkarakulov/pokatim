import { DisputeResponseRequest, Uuid, type DisputeAgainstMe } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  SkeletonHeroCard,
  TextField,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  againstDecisionText,
  categoryLabel,
  disputeDate,
  disputeErrorText,
  disputeStatus,
  responseError,
} from './dispute-format';
import { BackToRace, DisputeNotFound, DisputeScreenShell, useBackToRace } from './dispute-screen';
import { useMyRaceDisputes, useRespondToDispute } from './queries';

/** Ответ один раз (3–2000); видит только команда платформы. Успех — возврат к карточке гонки. */
function ResponseForm({ dispute, raceId }: { dispute: DisputeAgainstMe; raceId: string }) {
  const theme = useTheme();
  const respond = useRespondToDispute(raceId, dispute.id);
  const back = useBackToRace(raceId);
  const [text, setText] = useState('');
  const fieldError = responseError(text);
  const empty = text.trim() === '';

  const submit = async () => {
    if (empty || fieldError) return;
    try {
      await respond.mutateAsync(DisputeResponseRequest.parse({ text }));
    } catch {
      return; // текст отказа — из `respond.error`
    }
    back();
  };

  return (
    <View style={styles.form}>
      <TextField
        label={t('disputes.response.text')}
        value={text}
        onChangeText={setText}
        error={fieldError}
      />
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('disputes.response.hint')}
      </Text>
      {respond.error ? <Banner tone="error" message={disputeErrorText(respond.error)} /> : null}
      <Button
        label={t('disputes.response.submit')}
        loading={respond.isPending}
        disabled={empty || fieldError !== undefined || respond.isPending}
        onPress={() => void submit()}
      />
    </View>
  );
}

/** Спор по моему результату: категория и срок решения (без заявителя и описания — D-51); ответ — по `canRespond`. */
function ResponseView({ dispute, raceId }: { dispute: DisputeAgainstMe; raceId: string }) {
  const theme = useTheme();
  const status = dispute.response
    ? t('disputes.against.responded')
    : disputeStatus(dispute.status).label;
  return (
    <View style={styles.form}>
      {dispute.status === 'open' ? (
        <Banner
          tone="warning"
          message={t('disputes.against.banner', {
            category: categoryLabel(dispute.category),
            date: disputeDate(dispute.decidableBy),
          })}
        />
      ) : (
        <Banner message={againstDecisionText(dispute) ?? disputeStatus(dispute.status).label} />
      )}
      {dispute.canRespond ? (
        <ResponseForm dispute={dispute} raceId={raceId} />
      ) : (
        <View style={styles.form}>
          <Text style={[textStyle('body'), { color: theme.text.secondary }]}>{status}</Text>
          <BackToRace raceId={raceId} />
        </View>
      )}
    </View>
  );
}

/** «Ответ на спор» (`/races/dispute-response/<гонка>/<спор>`, внутри `Stack.Protected`). */
export function DisputeResponseScreen({
  raceId,
  disputeId,
}: {
  raceId: string;
  disputeId: string;
}) {
  const valid = Uuid.safeParse(raceId).success && Uuid.safeParse(disputeId).success;
  const disputes = useMyRaceDisputes(raceId, valid);
  const notFound = (
    <DisputeNotFound title={t('disputes.error.DISPUTE_NOT_FOUND')} raceId={raceId} />
  );

  return (
    <DisputeScreenShell
      title={t('disputes.response.title')}
      raceId={raceId}
      testID="dispute-response"
    >
      {valid ? (
        <AsyncContent query={disputes} skeleton={<SkeletonHeroCard />}>
          {(data) => {
            const dispute = data?.against.find((item) => item.id === disputeId);
            return dispute ? <ResponseView dispute={dispute} raceId={raceId} /> : notFound;
          }}
        </AsyncContent>
      ) : (
        notFound
      )}
    </DisputeScreenShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.s4 },
});
