import { isNetworkError } from '@pokatim/api-client';
import type {
  RaceFinisherRow,
  RaceResultRow,
  RaceResultsPage,
  ResultGroupKey,
} from '@pokatim/contracts';
import { motion, size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  Pill,
  SegmentedControl,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { finisherRow, groupLabel, resultRow } from './participation-format';
import { useRaceFinishers, useRaceResults } from './queries';

/** Строка таблицы; `onPress` — карточка соперника (race-results-06, RC-14): строка становится кнопкой. */
function ResultRow({
  row,
  own,
  onPress,
}: {
  row: RaceResultRow;
  own: boolean;
  onPress: (() => void) | null;
}) {
  const theme = useTheme();
  const view = resultRow(row, own);
  const style = [
    styles.row,
    { borderTopColor: theme.border.subtle },
    // полоса — роль рамки (акцентной рамки в системе нет); «Вы» — текстом, не только цветом
    own ? [styles.own, { borderLeftColor: theme.border.strong }] : null,
  ];
  const cells = (
    <>
      <Text style={[textStyle('time'), styles.place, { color: theme.text.primary }]}>
        {view.place}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          textStyle(own ? 'label' : 'body'),
          styles.who,
          { color: own ? theme.text.accent : theme.text.primary },
        ]}
      >
        {view.who}
      </Text>
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('disputes.rival.open', {
          who: view.who,
          place: view.place,
          time: view.time,
        })}
        onPress={onPress}
        style={({ pressed }) => [...style, { opacity: pressed ? motion.pressedOpacity : 1 }]}
      >
        {cells}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={view.a11y} style={style}>
      {cells}
    </View>
  );
}

type Tab = ResultGroupKey | 'finishers';

/** Строка финишёров: без места и без нажатия (споров у START и «без пульса» нет). */
function FinisherRowView({ row, own }: { row: RaceFinisherRow; own: boolean }) {
  const theme = useTheme();
  const view = finisherRow(row, own);
  return (
    <View
      accessible
      accessibilityLabel={view.a11y}
      style={[
        styles.row,
        { borderTopColor: theme.border.subtle },
        own ? [styles.own, { borderLeftColor: theme.border.strong }] : null,
      ]}
    >
      <View style={styles.who}>
        <Text
          numberOfLines={1}
          style={[
            textStyle(own ? 'label' : 'body'),
            { color: own ? theme.text.accent : theme.text.primary },
          ]}
        >
          {view.who}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{view.note}</Text>
      </View>
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
    </View>
  );
}

/** Скелетон строк таблицы. */
function RowsSkeleton() {
  return (
    <SkeletonGroup>
      <SkeletonListRow />
      <SkeletonListRow />
      <SkeletonListRow />
    </SkeletonGroup>
  );
}

/** Ошибка вкладки: компактный баннер с повтором — карточка гонки не ломается. */
function TabFailure({
  error,
  message,
  retry,
}: {
  error: unknown;
  message: string;
  retry: () => void;
}) {
  return (
    <View style={styles.failure}>
      <Banner
        tone="warning"
        title={t(isNetworkError(error) ? 'state.errorTitle' : 'state.failedTitle')}
        message={message}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={retry} />
      </View>
    </View>
  );
}

/** «Показать ещё» по курсору страницы. */
function MoreAction({
  query,
}: {
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: (o: { cancelRefetch: boolean }) => unknown;
  };
}) {
  if (!query.hasNextPage) return null;
  return (
    <View style={styles.start}>
      <TextAction
        label={t('races.results.more')}
        disabled={query.isFetchingNextPage}
        onPress={() => void query.fetchNextPage({ cancelRefetch: false })}
      />
    </View>
  );
}

/**
 * Вкладки таблицы (race-results-07): непустые группы из `groups` ответа по умолчанию (порядок сервера) и «Финишёры»
 * при `finishers > 0`. Групп нет, а финишёры есть (одни START) — вкладка группы ответа и «Финишёры». Старый API
 * (`groups: []`, `finishers: 0`) — без вкладок, как раньше.
 */
function tabsOf(page: RaceResultsPage | undefined): {
  groups: ResultGroupKey[];
  finishers: boolean;
} {
  if (!page) return { groups: [], finishers: false };
  const groups = page.groups
    .map((group) => group.key)
    .filter((key): key is ResultGroupKey => key !== 'unknown');
  const finishers = page.finishers > 0;
  if (groups.length === 0 && finishers && page.group !== 'unknown') {
    return { groups: [page.group], finishers };
  }
  return { groups, finishers };
}

/**
 * Предварительная таблица гонки (публичная): место («=N» при ничьей), имя райдера (с его согласием) или
 * «Участник» / «Вы» (своя — по id своей заявки, полоса и метка текстом), время. «Показать ещё» — по курсору. Ошибка —
 * компактный баннер с повтором: карточка гонки не ломается. Вкладки групп и «Финишёры» — race-results-07: запрос
 * группы уходит только для вкладки не по умолчанию и только после ответа с `groups` (RC-11); своя группа участника —
 * вкладка по умолчанию, если она есть в списке.
 */
export function RaceResultsTable({
  raceId,
  results,
  ownEntryId,
  ownGroup,
  rowAction,
}: {
  raceId: string;
  /** таблица группы по умолчанию сервера (запрос без `group`) */
  results: ReturnType<typeof useRaceResults>;
  ownEntryId: string | null;
  /** группа своей заявки — вкладка по умолчанию, если есть в `groups` */
  ownGroup?: ResultGroupKey | 'unknown' | null;
  /** нажатие на чужую строку (карточка соперника); `group` — вкладка не по умолчанию; `null` — не нажимаема */
  rowAction?: (entryId: string, group: ResultGroupKey | undefined) => (() => void) | null;
}) {
  const theme = useTheme();
  const first = results.data?.pages[0];
  const tabs = tabsOf(first);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tabKeys: Tab[] = [...tabs.groups, ...(tabs.finishers ? (['finishers'] as const) : [])];
  const fallback: Tab | null =
    tabs.groups.find((key) => key === ownGroup) ??
    tabs.groups.find((key) => key === first?.group) ??
    tabKeys[0] ??
    null;
  const tab = picked !== null && tabKeys.includes(picked) ? picked : fallback;
  // группа не по умолчанию — свой запрос с `group` (только когда сервер прислал `groups`)
  const group =
    tab !== null && tab !== 'finishers' && tab !== first?.group && first?.groups.length
      ? tab
      : undefined;
  const groupResults = useRaceResults(raceId, group !== undefined, group);
  const finishers = useRaceFinishers(raceId, tab === 'finishers');
  const shown = group ? groupResults : results;
  const pages = shown.data?.pages;
  const page = pages?.[0];
  const rows = pages?.flatMap((item) => item.items) ?? [];
  const finisherRows = finishers.data?.pages.flatMap((item) => item.items) ?? [];

  return (
    <View testID="race-results" style={styles.table}>
      <View style={styles.head}>
        <Text
          accessibilityRole="header"
          style={[textStyle('titleSm'), { color: theme.text.primary }]}
        >
          {t('races.results.title')}
        </Text>
        <Pill label={t('races.result.provisional')} tone="neutral" />
      </View>
      {tab !== null && tabKeys.length > 0 ? (
        // вкладок до восьми — прокрутка по горизонтали на узком экране
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={t('races.results.groups')}
        >
          <SegmentedControl<Tab>
            segments={tabKeys.map((key) => ({
              key,
              label: key === 'finishers' ? t('races.results.finishers') : groupLabel(key),
            }))}
            selected={tab}
            onChange={setPicked}
          />
        </ScrollView>
      ) : null}
      {tab === 'finishers' ? (
        <>
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('races.results.finishersHint')}
          </Text>
          {finishers.isError ? (
            <TabFailure
              error={finishers.error}
              message={t('races.results.finishersFailed')}
              retry={() => void finishers.refetch()}
            />
          ) : null}
          {finishers.data === undefined ? (
            finishers.isError ? null : (
              <RowsSkeleton />
            )
          ) : finisherRows.length === 0 ? (
            <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
              {t('races.results.finishersEmpty')}
            </Text>
          ) : (
            <View testID="race-finishers">
              {finisherRows.map((row) => (
                <FinisherRowView key={row.entryId} row={row} own={row.entryId === ownEntryId} />
              ))}
            </View>
          )}
          <MoreAction query={finishers} />
        </>
      ) : (
        <>
          {page ? (
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {t('races.results.count', { count: page.ranked })}
            </Text>
          ) : null}
          {shown.isError ? (
            <TabFailure
              error={shown.error}
              message={t('races.results.failed')}
              retry={() => void shown.refetch()}
            />
          ) : null}
          {pages === undefined ? (
            shown.isError ? null : (
              <RowsSkeleton />
            )
          ) : rows.length === 0 ? (
            <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
              {t('races.results.empty')}
            </Text>
          ) : (
            <View>
              {rows.map((row) => {
                const own = row.entryId === ownEntryId;
                return (
                  <ResultRow
                    key={row.entryId}
                    row={row}
                    own={own}
                    onPress={own ? null : (rowAction?.(row.entryId, group) ?? null)}
                  />
                );
              })}
            </View>
          )}
          <MoreAction query={shown} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { gap: space.s3 },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.s2 },
  failure: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    borderTopWidth: stroke.hairline,
  },
  own: { borderLeftWidth: stroke.indicator, paddingLeft: space.s2 },
  // колонка мест одной ширины («1», «12», «=12»): токен ширины короткого числового значения
  place: { minWidth: size.skeletonWord },
  who: { flex: 1 },
});
