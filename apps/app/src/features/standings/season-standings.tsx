import type {
  BikeClass,
  MySeasonStandings,
  ResultGroupKey,
  SeasonStandingRow,
  SeasonStandingsSummary,
} from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, EmptyState, SegmentedControl, textStyle, useTheme } from '@rkarakulov/ui';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { groupLabel } from '@/features/races/participation-format';
import { loading, MoreAction, RowsSkeleton, TabFailure } from '@/features/races/results-table';
import { RiderWho, TableRow, useRowAction } from '@/features/races/table-row';

import { useMySeasonStandings, useSeasonStandings, useSeasonStandingsTable } from './queries';
import {
  classLabel,
  ownOrder,
  pickTable,
  standingRow,
  tableLabel,
  type PickedTable,
} from './standings-format';

/**
 * Строка таблицы сезона: место («=6»), кто, очки; своя — «Вы» полосой рамки и текстом (не только цветом). Публичный
 * райдер — аватар и ссылка на профиль (rider-links-in-tables).
 */
function StandingRowView({ row, own }: { row: SeasonStandingRow; own: boolean }) {
  const theme = useTheme();
  const view = standingRow(row, own);
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
      <Text style={[textStyle('time'), styles.place, { color: theme.text.primary }]}>
        {view.place}
      </Text>
      <RiderWho
        who={view.who}
        own={own}
        riderPublicId={row.riderPublicId}
        avatarId={row.riderAvatar?.id ?? null}
      />
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.points}</Text>
    </TableRow>
  );
}

/**
 * Выбранная таблица: переключатели класса и группы (только таблицы сводки), заметка «лучшие N из M», подпись,
 * строки, «Показать ещё». Счётчики (N, M, участники) — из первой страницы таблицы (её снимок), сводка — только для
 * переключателей и до ответа. «Вы» — по `order` из `/me` только при одном снимке (RC-11); снимки разошлись — один
 * раз перезапрашивается более старый ответ (таблица — в обход HTTP-кэша, где можно).
 */
function StandingsTables({
  seasonId,
  summary,
  me,
}: {
  seasonId: string;
  summary: SeasonStandingsSummary;
  me: ReturnType<typeof useMySeasonStandings>;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<PickedTable>({});
  const table = pickTable(summary.tables, me.data, picked);
  const query = useSeasonStandingsTable(seasonId, table);
  const pages = query.data?.pages;
  const first = pages?.[0];
  const own = ownOrder(first, me.data);
  useSnapshotSync(first?.computedAt, me.data, query.refetchFresh, me.refetch);

  if (!table) return null;
  const counts = first ?? table;
  const rows = pages?.flatMap((page) => page.items) ?? [];
  const pickClass = (bikeClass: BikeClass) => setPicked((prev) => ({ ...prev, bikeClass }));
  const pickGroup = (groupKey: ResultGroupKey) =>
    setPicked({ bikeClass: table.bikeClass, groupKey });

  return (
    <View style={styles.tables}>
      {/* классов и групп до восьми — прокрутка по горизонтали на узком экране */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={t('season.standings.classes')}
      >
        <SegmentedControl<BikeClass>
          segments={table.classes.map((key) => ({ key, label: classLabel(key) }))}
          selected={table.bikeClass}
          onChange={pickClass}
        />
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={t('season.standings.groups')}
      >
        <SegmentedControl<ResultGroupKey>
          segments={table.groups.map((key) => ({ key, label: groupLabel(key) }))}
          selected={table.groupKey}
          onChange={pickGroup}
        />
      </ScrollView>
      {/* таблицы нет в снимке (RC-12) — M = 0, заметки нет */}
      {counts.racesTotal > 0 ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('season.standings.note', { count: counts.racesTotal, counted: counts.racesCounted })}
        </Text>
      ) : null}
      <Text style={[textStyle('label'), { color: theme.text.primary }]}>
        {t('season.standings.caption', {
          table: tableLabel(table.groupKey, table.bikeClass),
          count: counts.riders,
        })}
      </Text>
      <TabFailure query={query} message={t('season.standings.failed')} />
      {pages === undefined ? (
        loading(query) ? (
          <RowsSkeleton />
        ) : null
      ) : rows.length === 0 ? (
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t('season.standings.empty')}
        </Text>
      ) : (
        <View>
          {rows.map((row) => (
            <StandingRowView key={row.order} row={row} own={row.order === own} />
          ))}
        </View>
      )}
      <MoreAction query={query} />
    </View>
  );
}

/** RC-11: снимки таблицы и `/me` разошлись — перезапрос более старого, один раз на пару снимков. */
function useSnapshotSync(
  tableAt: string | null | undefined,
  me: MySeasonStandings | undefined,
  refetchTable: () => unknown,
  refetchMe: () => unknown,
) {
  const synced = useRef<string | null>(null);
  const meAt = me?.computedAt;
  useEffect(() => {
    if (tableAt === undefined || meAt === undefined || tableAt === meAt) return;
    const pair = `${tableAt ?? ''}|${meAt ?? ''}`;
    if (synced.current === pair) return;
    synced.current = pair;
    if ((tableAt ?? '') < (meAt ?? '')) void refetchTable();
    else void refetchMe();
  }, [tableAt, meAt, refetchTable, refetchMe]);
}

/**
 * Блок «Таблица сезона» экрана сезона (race-results-08c, RC-17): в шапке списка над «Гонками сезона». Сводка и
 * таблица — публичные клиентские запросы (в SSR не попадают — скелетон), «моё» — только вошедшему. Пусто — «Сезон
 * только начался» с действием «К гонкам». Очки, места и «в зачёте» — только с сервера.
 */
export function SeasonStandings({
  seasonId,
  dates,
  signedIn,
  onToRaces,
}: {
  seasonId: string;
  /** даты сезона («1 апреля–31 октября 2026»); сезон ещё не загружен — `null` */
  dates: string | null;
  signedIn: boolean;
  onToRaces: () => void;
}) {
  const theme = useTheme();
  const summary = useSeasonStandings(seasonId, true);
  const me = useMySeasonStandings(seasonId, signedIn);
  // вошедшему таблица по умолчанию — своя: ждём `/me` (ошибка и пауза без сети — не ждём)
  const meSettled = !signedIn || me.data !== undefined || me.isError || me.fetchStatus === 'paused';
  const state = meSettled
    ? summary
    : { ...summary, data: undefined, isPending: true, isError: false };

  return (
    <View testID="season-standings" style={styles.block}>
      <View style={styles.head}>
        <Text
          accessibilityRole="header"
          style={[textStyle('displaySm'), { color: theme.text.primary }]}
        >
          {t('season.standings.title')}
        </Text>
        {dates ? (
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('season.standings.subtitle', { dates })}
          </Text>
        ) : null}
      </View>
      {/* «моё» — свой баннер с повтором; публичная таблица остаётся. Сводки ещё нет — её состояние покажет блок ниже */}
      {signedIn && summary.data !== undefined ? (
        <TabFailure query={me} message={t('season.standings.meFailed')} />
      ) : null}
      <AsyncContent
        query={state}
        skeleton={<RowsSkeleton />}
        empty={{
          when: (data) => pickTable(data.tables, undefined, {}) === null,
          render: () => (
            <EmptyState
              title={t('season.standings.emptyTitle')}
              message={t('season.standings.emptyMessage')}
              action={{ label: t('season.standings.toRaces'), onPress: onToRaces }}
            />
          ),
        }}
      >
        {(data) => <StandingsTables seasonId={seasonId} summary={data} me={me} />}
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: size.sectionGap, gap: space.s3 },
  head: { gap: space.s1 },
  tables: { gap: space.s3 },
  // строка-ссылка (публичный профиль) — не ниже минимальной цели касания
  row: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    borderTopWidth: stroke.hairline,
  },
  own: { borderLeftWidth: stroke.indicator, paddingLeft: space.s2 },
  // колонка мест одной ширины («1», «12», «=12») — как таблица гонки
  place: { minWidth: size.skeletonWord },
});
