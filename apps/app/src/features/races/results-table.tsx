import { isNetworkError } from '@pokatim/api-client';
import type { RaceResultRow } from '@pokatim/contracts';
import { motion, size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  Pill,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { resultRow } from './participation-format';
import type { useRaceResults } from './queries';

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

/**
 * Предварительная таблица гонки (публичная): место («=N» при ничьей), имя райдера (с его согласием) или
 * «Участник» / «Вы» (своя — по id
 * своей заявки, полоса и метка текстом), время. «Показать ещё» — по курсору. Ошибка — компактный баннер с повтором:
 * карточка гонки не ломается.
 */
export function RaceResultsTable({
  results,
  ownEntryId,
  rowAction,
}: {
  results: ReturnType<typeof useRaceResults>;
  ownEntryId: string | null;
  /** нажатие на чужую строку (карточка соперника); `null` — строка не нажимаема */
  rowAction?: (entryId: string) => (() => void) | null;
}) {
  const theme = useTheme();
  const pages = results.data?.pages;
  const first = pages?.[0];
  const rows = pages?.flatMap((page) => page.items) ?? [];

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
      {first ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('races.results.count', { count: first.ranked })}
        </Text>
      ) : null}
      {results.isError ? (
        <View style={styles.failure}>
          <Banner
            tone="warning"
            title={t(isNetworkError(results.error) ? 'state.errorTitle' : 'state.failedTitle')}
            message={t('races.results.failed')}
          />
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={() => void results.refetch()} />
          </View>
        </View>
      ) : null}
      {pages === undefined ? (
        results.isError ? null : (
          <SkeletonGroup>
            <SkeletonListRow />
            <SkeletonListRow />
            <SkeletonListRow />
          </SkeletonGroup>
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
                onPress={own ? null : (rowAction?.(row.entryId) ?? null)}
              />
            );
          })}
        </View>
      )}
      {results.hasNextPage ? (
        <View style={styles.start}>
          <TextAction
            label={t('races.results.more')}
            disabled={results.isFetchingNextPage}
            onPress={() => void results.fetchNextPage({ cancelRefetch: false })}
          />
        </View>
      ) : null}
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
