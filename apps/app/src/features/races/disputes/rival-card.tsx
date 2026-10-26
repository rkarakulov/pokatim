import { Uuid, type MyRaceDisputes } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Button, Pill, SkeletonHeroCard, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useRaceResults } from '../queries';
import { categoryLabel, disputeStatus, filedDecisionText, rivalAction } from './dispute-format';
import {
  ActionSkeleton,
  DisputeNotFound,
  DisputeScreenShell,
  DisputesFailure,
  findRow,
  RivalResult,
} from './dispute-screen';
import { useMyRaceDisputes } from './queries';

/** Действие карточки по `filing` сервера (§7.8, M1): подать, выключенное с причиной, статус моего спора, ничего. */
function RivalAction({
  disputes,
  raceId,
  entryId,
}: {
  disputes: MyRaceDisputes;
  raceId: string;
  entryId: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const action = rivalAction(disputes, entryId);
  const meta = [textStyle('meta'), { color: theme.text.secondary }];
  if (action === null) return null;
  if (action.kind === 'mine') {
    const status = disputeStatus(action.dispute.status);
    const decision = filedDecisionText(action.dispute);
    return (
      <View style={styles.stack}>
        <View style={styles.start}>
          <Pill label={status.label} tone={status.tone} />
        </View>
        <Text style={meta}>{categoryLabel(action.dispute.category)}</Text>
        {decision ? <Text style={meta}>{decision}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Button
        label={t('disputes.file.action')}
        variant="secondary"
        disabled={action.kind === 'closed'}
        onPress={() => router.push(`/races/dispute/${raceId}/${entryId}`)}
      />
      <Text style={meta}>{action.note}</Text>
    </View>
  );
}

/**
 * Карточка соперника (`/races/result/<гонка>/<заявка>`, RC-14; внутри `Stack.Protected`): место и время — из кэша
 * таблицы (холодный старт — первая страница); строки нет — «Результат не найден». Действие — по «моим спорам».
 */
export function RivalCardScreen({ raceId, entryId }: { raceId: string; entryId: string }) {
  const valid = Uuid.safeParse(raceId).success && Uuid.safeParse(entryId).success;
  const results = useRaceResults(raceId, valid);
  const disputes = useMyRaceDisputes(raceId, valid);
  const title = t('disputes.rival.title');

  return (
    <DisputeScreenShell title={title} raceId={raceId} testID="rival-card">
      {valid ? (
        <AsyncContent query={results} skeleton={<SkeletonHeroCard />}>
          {(data) => {
            const found = findRow(data, entryId);
            if (!found)
              return <DisputeNotFound title={t('disputes.rival.notFound')} raceId={raceId} />;
            return (
              <View style={styles.card}>
                <RivalResult row={found.row} page={found.page} />
                {disputes.data ? (
                  <RivalAction disputes={disputes.data} raceId={raceId} entryId={entryId} />
                ) : disputes.isError ? (
                  <DisputesFailure error={disputes.error} retry={() => void disputes.refetch()} />
                ) : disputes.isPending ? (
                  <ActionSkeleton />
                ) : null}
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
  card: { gap: space.s4 },
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
