import { Uuid, type MyRaceDisputes, type ResultGroupKey } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Button,
  Pill,
  SkeletonHeroCard,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { riderPath } from '@/features/riders/queries';

import { useMyRaceEntry, useRaceResults } from '../queries';
import { ShareStoryButton } from '../story/share-story-button';
import {
  categoryLabel,
  disputeStatus,
  filedDecisionText,
  inOtherGroup,
  rivalAction,
} from './dispute-format';
import {
  ActionSkeleton,
  ActionSkeletonLines,
  DisputeNotFound,
  DisputeScreenShell,
  disputeFilePath,
  DisputesFailure,
  findRow,
  RivalResult,
} from './dispute-screen';
import { useMyRaceDisputes } from './queries';

/**
 * Действие карточки по `filing` сервера (§7.8, M1): подать, выключенное с причиной, статус моего спора, ничего.
 * Соперник в чужой группе зачёта (`otherGroup`) — причина вместо подачи.
 */
function RivalAction({
  disputes,
  raceId,
  entryId,
  group,
  otherGroup,
}: {
  disputes: MyRaceDisputes;
  raceId: string;
  entryId: string;
  group: ResultGroupKey | undefined;
  otherGroup: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const action = rivalAction(disputes, entryId, otherGroup);
  const meta = [textStyle('meta'), { color: theme.text.secondary }];
  if (action === null) {
    return otherGroup ? <Text style={meta}>{t('disputes.file.otherGroup')}</Text> : null;
  }
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
        onPress={() => router.push(disputeFilePath(raceId, entryId, group))}
      />
      <Text style={meta}>{action.note}</Text>
    </View>
  );
}

/**
 * Карточка соперника (`/races/result/<гонка>/<заявка>`, RC-14; внутри `Stack.Protected`): место и время — из кэша
 * таблицы (холодный старт — первая страница); строки нет — «Результат не найден». Действие — по «моим спорам».
 */
export function RivalCardScreen({
  raceId,
  entryId,
  group,
}: {
  raceId: string;
  entryId: string;
  /** вкладка группы таблицы (race-results-07); нет — группа по умолчанию */
  group?: ResultGroupKey;
}) {
  const valid = Uuid.safeParse(raceId).success && Uuid.safeParse(entryId).success;
  const results = useRaceResults(raceId, valid, group);
  const disputes = useMyRaceDisputes(raceId, valid);
  // группа своей заявки — подача только в своей группе зачёта (race-results-07)
  const entry = useMyRaceEntry(raceId, valid);
  // своя строка (story-cards): «Ваш результат» и «Поделиться в сторис», без подачи спора
  const own = entry.data?.entry?.id === entryId;
  const title = t(own ? 'races.result.ownTitle' : 'disputes.rival.title');
  const router = useRouter();

  return (
    <DisputeScreenShell title={title} raceId={raceId} testID="rival-card">
      {valid ? (
        <AsyncContent query={results} skeleton={<SkeletonHeroCard />}>
          {(data) => {
            const found = findRow(data, entryId);
            if (!found)
              return <DisputeNotFound title={t('disputes.rival.notFound')} raceId={raceId} />;
            const mine = disputes.data;
            return (
              <View style={styles.card}>
                <RivalResult row={found.row} page={found.page} />
                {/* публичный профиль соперника (rider-links-in-tables): только при его имени и согласии */}
                {!own && found.row.riderPublicId !== null ? (
                  <View style={styles.start}>
                    <TextAction
                      label={t('disputes.rival.profile')}
                      onPress={() => router.push(riderPath(found.row.riderPublicId!))}
                    />
                  </View>
                ) : null}
                {own ? (
                  entry.data?.actions.canShareStory ? (
                    <ShareStoryButton raceId={raceId} />
                  ) : null
                ) : mine ? (
                  // участие не загружено — подача не предлагается (ошибка и «Нет соединения» с повтором)
                  <AsyncContent query={entry} skeleton={<ActionSkeletonLines />}>
                    {(own) => (
                      <RivalAction
                        disputes={mine}
                        raceId={raceId}
                        entryId={entryId}
                        group={group}
                        otherGroup={inOtherGroup(own?.entry?.groupKey, found.page.group)}
                      />
                    )}
                  </AsyncContent>
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
