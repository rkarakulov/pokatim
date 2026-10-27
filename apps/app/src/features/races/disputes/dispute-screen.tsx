import { isNetworkError } from '@pokatim/api-client';
import {
  RESULT_GROUP_KEYS,
  type RaceResultRow,
  type RaceResultsPage,
  type ResultGroupKey,
} from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  EmptyState,
  Kicker,
  Pill,
  SkeletonGroup,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import type { InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';

import { resultRow } from '../participation-format';

export const racePath = (raceId: string) => `/races/${raceId}`;

/**
 * Группа зачёта строки (race-results-07): вкладка таблицы не по умолчанию — `?group=` в путях карточки соперника и
 * подачи спора, чтобы экран читал ту же страницу таблицы. Незнакомое значение ссылки — без группы.
 */
export const groupParam = (value: string | string[] | undefined): ResultGroupKey | undefined =>
  RESULT_GROUP_KEYS.find((key) => key === value);
const groupQuery = (group: ResultGroupKey | undefined) => (group ? `?group=${group}` : '');
export const rivalPath = (raceId: string, entryId: string, group?: ResultGroupKey) =>
  `/races/result/${raceId}/${entryId}${groupQuery(group)}`;
export const disputeFilePath = (raceId: string, entryId: string, group?: ResultGroupKey) =>
  `/races/dispute/${raceId}/${entryId}${groupQuery(group)}`;

/** Строка соперника из кэша таблицы (`useRaceResults`); нет на загруженных страницах — `null`. */
export function findRow(
  data: InfiniteData<RaceResultsPage> | undefined,
  entryId: string,
): { row: RaceResultRow; page: RaceResultsPage } | null {
  for (const page of data?.pages ?? []) {
    const row = page.items.find((item) => item.entryId === entryId);
    if (row) return { row, page };
  }
  return null;
}

/** Возврат к карточке гонки: она уже в стеке — снять экраны над ней, нет (ссылка) — заменить. */
export function useBackToRace(raceId: string) {
  const router = useRouter();
  return () => router.dismissTo(racePath(raceId));
}

/** Ссылка «К гонке». */
export function BackToRace({ raceId }: { raceId: string }) {
  const back = useBackToRace(raceId);
  return (
    <View style={styles.start}>
      <TextAction label={t('disputes.rival.back')} onPress={back} />
    </View>
  );
}

/** Нет строки или спора: пустое состояние и «К гонке». */
export function DisputeNotFound({ title, raceId }: { title: string; raceId: string }) {
  const back = useBackToRace(raceId);
  return <EmptyState title={title} action={{ label: t('disputes.rival.back'), onPress: back }} />;
}

/** Оболочка экранов спора: шапка с «Назад», заголовок документа, прокрутка с отступами системы. */
export function DisputeScreenShell({
  title,
  raceId,
  testID,
  children,
}: {
  title: string;
  raceId: string;
  testID: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={racePath(raceId)} />
      <ScrollView
        testID={testID}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Оспариваемый результат: «N место», имя райдера (с его согласием) или «Участник», время, статус таблицы. */
export function RivalResult({ row, page }: { row: RaceResultRow; page: RaceResultsPage }) {
  const theme = useTheme();
  const view = resultRow(row, false);
  const status =
    page.status === 'final' ? t('races.result.status.final') : t('disputes.rival.status');
  return (
    <View style={styles.result}>
      <Kicker label={t('disputes.rival.place', { place: view.place })} />
      <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
        {row.riderName ?? t('disputes.rival.participant')}
      </Text>
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
      <View style={styles.start}>
        <Pill label={status} tone="neutral" />
      </View>
    </View>
  );
}

/** Ошибка запроса споров на месте действия: компактный баннер с повтором (экран не ломается). */
export function DisputesFailure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <View style={styles.result}>
      <Banner
        tone="warning"
        title={t(isNetworkError(error) ? 'state.errorTitle' : 'state.failedTitle')}
        message={t('state.failedMessage')}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={retry} />
      </View>
    </View>
  );
}

export function ActionSkeleton() {
  return (
    <SkeletonGroup>
      <SkeletonText variant="body" lines={2} lastLineWidth="60%" />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s4 },
  result: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
