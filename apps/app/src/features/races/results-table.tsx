import { isNetworkError } from '@pokatim/api-client';
import type {
  RaceFinisherRow,
  RaceResultRow,
  RaceResultsPage,
  ResultGroupKey,
} from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
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
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { finisherRow, groupLabel, resultRow } from './participation-format';
import { useRaceFinishers, useRaceResults } from './queries';
import { RiderWho, TableRow, useRowAction } from './table-row';

/**
 * Строка таблицы; `onPress` — карточка соперника (race-results-06, RC-14) или «Ваш результат»: строка — кнопка. Иначе
 * у публичного райдера — ссылка на его профиль (rider-links-in-tables), у «Участника» — без нажатия.
 */
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
  const action = useRowAction(
    onPress && {
      label: t('disputes.rival.open', { who: view.who, place: view.place, time: view.time }),
      onPress,
    },
    row.riderPublicId,
    view.profileA11y,
  );
  return (
    <TableRow
      a11y={view.a11y}
      action={action}
      style={[
        styles.row,
        { borderTopColor: theme.border.subtle },
        // полоса — роль рамки (акцентной рамки в системе нет); «Вы» — текстом, не только цветом
        own ? [styles.own, { borderLeftColor: theme.border.strong }] : null,
      ]}
    >
      <Text style={[textStyle('time'), styles.place, { color: theme.text.primary }]}>
        {view.place}
      </Text>
      <RiderWho
        who={view.who}
        own={own}
        riderPublicId={row.riderPublicId}
        avatarId={row.riderAvatar?.id ?? null}
      />
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
    </TableRow>
  );
}

type Tab = ResultGroupKey | 'finishers';

/**
 * Строка финишёров: без места; споров у START и «без пульса» нет — нажатие только у публичного райдера (ссылка на
 * профиль, rider-links-in-tables).
 */
function FinisherRowView({ row, own }: { row: RaceFinisherRow; own: boolean }) {
  const theme = useTheme();
  const view = finisherRow(row, own);
  const action = useRowAction(null, row.riderPublicId, view.profileA11y);
  return (
    <TableRow
      a11y={view.a11y}
      action={action}
      style={[
        styles.row,
        { borderTopColor: theme.border.subtle },
        own ? [styles.own, { borderLeftColor: theme.border.strong }] : null,
      ]}
    >
      <RiderWho
        who={view.who}
        own={own}
        riderPublicId={row.riderPublicId}
        avatarId={row.riderAvatar?.id ?? null}
        note={view.note}
      />
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
    </TableRow>
  );
}

/** Скелетон строк таблицы. */
export function RowsSkeleton() {
  return (
    <SkeletonGroup>
      <SkeletonListRow />
      <SkeletonListRow />
      <SkeletonListRow />
    </SkeletonGroup>
  );
}

/** Запрос вкладки: минимум для состояний загрузки и ошибки. */
export interface TabQuery {
  data: unknown;
  error: unknown;
  isError: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => unknown;
}

/**
 * Ошибка вкладки: компактный баннер с повтором — карточка гонки не ломается. Без сети первая загрузка вкладки встаёт
 * на паузу (`onlineManager`) — сразу «Нет соединения», не вечный скелетон (§4.12, как `AsyncContent`).
 */
export function TabFailure({ query, message }: { query: TabQuery; message: string }) {
  const offline = query.data === undefined && query.fetchStatus === 'paused';
  if (!offline && !query.isError) return null;
  const network = offline || isNetworkError(query.error);
  return (
    <View style={styles.failure}>
      <Banner
        tone="warning"
        title={t(network ? 'state.errorTitle' : 'state.failedTitle')}
        message={message}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={() => void query.refetch()} />
      </View>
    </View>
  );
}

/** Первая загрузка вкладки идёт (не ошибка и не пауза без сети) — скелетон. */
export const loading = (query: TabQuery) => !query.isError && query.fetchStatus !== 'paused';

/** «Показать ещё» по курсору страницы. */
export function MoreAction({
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
  ownRowAction = null,
}: {
  raceId: string;
  /** таблица группы по умолчанию сервера (запрос без `group`) */
  results: ReturnType<typeof useRaceResults>;
  ownEntryId: string | null;
  /** группа своей заявки — вкладка по умолчанию, если есть в `groups` */
  ownGroup?: ResultGroupKey | 'unknown' | null;
  /** нажатие на чужую строку (карточка соперника); `group` — вкладка не по умолчанию; `null` — не нажимаема */
  rowAction?: (entryId: string, group: ResultGroupKey | undefined) => (() => void) | null;
  /**
   * нажатие на свою строку (story-cards: «Ваш результат» и «Поделиться в сторис»); `group` — вкладка не по умолчанию
   * (своя группа может отличаться от группы сервера по умолчанию); `null` — не нажимаема
   */
  ownRowAction?: ((group: ResultGroupKey | undefined) => (() => void) | null) | null;
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
          <TabFailure query={finishers} message={t('races.results.finishersFailed')} />
          {finishers.data === undefined ? (
            loading(finishers) ? (
              <RowsSkeleton />
            ) : null
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
          <TabFailure query={shown} message={t('races.results.failed')} />
          {pages === undefined ? (
            loading(shown) ? (
              <RowsSkeleton />
            ) : null
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
                    onPress={
                      own
                        ? (ownRowAction?.(group) ?? null)
                        : (rowAction?.(row.entryId, group) ?? null)
                    }
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
  // строка может быть кнопкой или ссылкой — не ниже минимальной цели касания
  row: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    borderTopWidth: stroke.hairline,
  },
  own: { borderLeftWidth: stroke.indicator, paddingLeft: space.s2 },
  // колонка мест одной ширины («1», «12», «=12»): токен ширины короткого числового значения
  place: { minWidth: size.skeletonWord },
});
