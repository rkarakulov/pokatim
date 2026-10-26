import {
  DISPUTE_CATEGORIES,
  DisputeFileRequest,
  Uuid,
  type DisputeCategory,
  type MyRaceDisputes,
} from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  Chip,
  SkeletonHeroCard,
  TextField,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRaceResults } from '../queries';
import {
  categoryLabel,
  descriptionError,
  disputeErrorText,
  disputeStatus,
  rivalAction,
} from './dispute-format';
import {
  ActionSkeleton,
  BackToRace,
  DisputeNotFound,
  DisputeScreenShell,
  DisputesFailure,
  findRow,
  RivalResult,
  useBackToRace,
} from './dispute-screen';
import { useFileDispute, useMyRaceDisputes } from './queries';

/**
 * Форма спора (§7.8): категория обязательна (без неё «Отправить спор» выключено с причиной), описание необязательно
 * (≤ 2000), срок приёма и видимость (D-51), без вложений (A10). Отказ 409 — текст по `details.reason`; успех —
 * возврат к карточке гонки (споры, участие и таблица инвалидированы).
 */
function FileForm({
  raceId,
  entryId,
  deadline,
}: {
  raceId: string;
  entryId: string;
  deadline: string;
}) {
  const theme = useTheme();
  const file = useFileDispute(raceId);
  const back = useBackToRace(raceId);
  const [category, setCategory] = useState<DisputeCategory>();
  const [description, setDescription] = useState('');
  const fieldError = descriptionError(description);
  const meta = [textStyle('meta'), { color: theme.text.secondary }];

  const submit = async () => {
    if (!category || fieldError) return;
    const body = DisputeFileRequest.parse({ targetEntryId: entryId, category, description });
    try {
      await file.mutateAsync(body);
    } catch {
      return; // текст отказа — из `file.error`
    }
    back();
  };

  return (
    <View style={styles.form}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('disputes.file.category')}
      </Text>
      <View style={styles.chips}>
        {DISPUTE_CATEGORIES.map((value) => (
          <Chip
            key={value}
            label={categoryLabel(value)}
            selected={category === value}
            onPress={() => setCategory(value)}
          />
        ))}
      </View>
      <TextField
        label={t('disputes.file.description')}
        value={description}
        onChangeText={setDescription}
        error={fieldError}
      />
      <Text style={meta}>{t('disputes.file.visibility')}</Text>
      <Text style={meta}>{deadline}</Text>
      {file.error ? <Banner tone="error" message={disputeErrorText(file.error)} /> : null}
      <Button
        label={t('disputes.file.submit')}
        loading={file.isPending}
        disabled={!category || fieldError !== undefined || file.isPending}
        onPress={() => void submit()}
      />
      {category ? null : <Text style={meta}>{t('disputes.file.chooseCategory')}</Text>}
    </View>
  );
}

/** Подать нельзя (срок, лимит, уже подан): статус или причина вместо формы. */
function FormGate({
  disputes,
  raceId,
  entryId,
}: {
  disputes: MyRaceDisputes;
  raceId: string;
  entryId: string;
}) {
  const theme = useTheme();
  const action = rivalAction(disputes, entryId);
  if (action?.kind === 'file') {
    return <FileForm raceId={raceId} entryId={entryId} deadline={action.note} />;
  }
  const text =
    action === null
      ? t(`disputes.filingBlock.${disputes.filing.reason ?? 'unknown'}`)
      : action.kind === 'mine'
        ? disputeStatus(action.dispute.status).label
        : action.note;
  return (
    <View style={styles.form}>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>{text}</Text>
      <BackToRace raceId={raceId} />
    </View>
  );
}

/** «Оспорить результат» (`/races/dispute/<гонка>/<заявка>`, внутри `Stack.Protected`). */
export function DisputeFormScreen({ raceId, entryId }: { raceId: string; entryId: string }) {
  const theme = useTheme();
  const valid = Uuid.safeParse(raceId).success && Uuid.safeParse(entryId).success;
  const results = useRaceResults(raceId, valid);
  const disputes = useMyRaceDisputes(raceId, valid);

  return (
    <DisputeScreenShell title={t('disputes.file.title')} raceId={raceId} testID="dispute-form">
      {valid ? (
        <AsyncContent query={results} skeleton={<SkeletonHeroCard />}>
          {(data) => {
            const found = findRow(data, entryId);
            if (!found) {
              return <DisputeNotFound title={t('disputes.rival.notFound')} raceId={raceId} />;
            }
            return (
              <View style={styles.form}>
                <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
                  {t('disputes.file.target')}
                </Text>
                <RivalResult row={found.row} page={found.page} />
                {disputes.data ? (
                  <FormGate disputes={disputes.data} raceId={raceId} entryId={entryId} />
                ) : disputes.isError ? (
                  <DisputesFailure error={disputes.error} retry={() => void disputes.refetch()} />
                ) : disputes.isPending ? (
                  <ActionSkeleton />
                ) : (
                  <BackToRace raceId={raceId} />
                )}
              </View>
            );
          }}
        </AsyncContent>
      ) : (
        <DisputeNotFound title={t('disputes.rival.notFound')} raceId={raceId} />
      )}
    </DisputeScreenShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.s4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
