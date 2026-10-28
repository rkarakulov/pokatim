import type { MySeasonStandings, SeasonCard, SeasonStandingCell } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useHeaderSeasonState } from '@/features/races/queries';
import { loading, RowsSkeleton, TabFailure } from '@/features/races/results-table';

import { useMySeasonStandings } from './queries';
import {
  cellResult,
  cellResultA11y,
  cellStatus,
  placeView,
  pointsText,
  tableLabel,
} from './standings-format';

/** Гонка своей таблицы: название, итог («2 · 85 очков», «DQ · 0», «—»), «в зачёте» / «не в зачёте». */
function RaceLine({ title, cell }: { title: string; cell: SeasonStandingCell }) {
  const theme = useTheme();
  const result = cellResult(cell);
  const status = cellStatus(cell);
  return (
    <View
      accessible
      accessibilityLabel={t('profile.season.raceA11y', {
        race: title,
        result: cellResultA11y(cell),
        status,
      })}
      style={[styles.race, { borderTopColor: theme.border.subtle }]}
    >
      <View style={styles.raceText}>
        <Text numberOfLines={1} style={[textStyle('body'), { color: theme.text.primary }]}>
          {title}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{status}</Text>
      </View>
      <Text style={[textStyle('time'), { color: theme.text.primary }]}>{result}</Text>
    </View>
  );
}

function SeasonContent({ season, data }: { season: SeasonCard; data: MySeasonStandings }) {
  const theme = useTheme();
  const router = useRouter();
  // несколько таблиц (разные классы) — первая своя строка в порядке сервера
  const own = data.items[0];
  if (!own) return null;
  const place = placeView(own.place, own.tied);
  const points = pointsText(own.points);
  const table = tableLabel(own.groupKey, own.bikeClass);
  const titles = new Map(data.races.map((race) => [race.id, race.title]));
  return (
    <>
      <Text style={[textStyle('metaLg'), { color: theme.text.secondary }]}>{season.name}</Text>
      <View
        accessible
        accessibilityLabel={t('profile.season.ownA11y', { place: place.a11y, points, table })}
        style={styles.own}
      >
        <Text style={[textStyle('displaySm'), { color: theme.text.primary }]}>{place.text}</Text>
        <View style={styles.ownText}>
          <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{points}</Text>
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{table}</Text>
        </View>
      </View>
      <View style={styles.start}>
        <TextAction
          label={t('profile.season.all')}
          onPress={() => router.push(`/seasons/${season.id}`)}
        />
      </View>
      <View>
        {own.cells.map((cell) => (
          <RaceLine key={cell.raceId} title={titles.get(cell.raceId) ?? ''} cell={cell} />
        ))}
      </View>
    </>
  );
}

type SeasonState = ReturnType<typeof useHeaderSeasonState>;
type MeQuery = ReturnType<typeof useMySeasonStandings>;

/**
 * Блок «Сезон» «Профиля» (race-results-08c, RC-18): сезон — тот же, что кнопка вкладки «Гонки» (тот же кэш,
 * `useHeaderSeasonState`). Своя строка (место, очки, «{группа} · {класс}»), «Вся таблица» → экран сезона, гонки своей
 * таблицы. Состояния §4.12 — и для определения сезона, и для `/me`: первая загрузка — скелетон, ошибка без данных —
 * баннер с повтором, ошибка обновления — данные остаются + баннер. Скрыт, только когда без ошибок известно, что
 * сезона нет или своих строк нет.
 */
export function ProfileSeasonBlock() {
  const state = useHeaderSeasonState();
  const { season, current, all, between } = state;
  const me = useMySeasonStandings(season?.id ?? '', season !== null);
  const seasonFailed = current.isError || (between && all.isError);
  // ещё определяется: нет данных текущего сезона или (между сезонами) списка
  const resolving = current.data === undefined || (between && all.data === undefined);
  if (season === null) {
    if (!resolving && !seasonFailed) return null;
    return <SeasonSection state={state} me={null} />;
  }
  if (me.data !== undefined && me.data.items.length === 0 && !me.isError && !seasonFailed) {
    return null;
  }
  return <SeasonSection state={state} me={me} />;
}

function SeasonSection({ state, me }: { state: SeasonState; me: MeQuery | null }) {
  const theme = useTheme();
  const { season, current, all, between } = state;
  // запрос, который определяет сезон сейчас: между сезонами — список
  const seasonQuery = between ? all : current;
  const own = me?.data;
  return (
    <View testID="profile-season" style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), { color: theme.text.primary }]}
      >
        {t('profile.season.title')}
      </Text>
      <TabFailure query={current} message={t('profile.season.seasonFailed')} />
      {between ? <TabFailure query={all} message={t('profile.season.seasonFailed')} /> : null}
      {me ? <TabFailure query={me} message={t('profile.season.failed')} /> : null}
      {season === null || me === null ? (
        seasonQuery.data === undefined && loading(seasonQuery) ? (
          <RowsSkeleton />
        ) : null
      ) : own === undefined ? (
        loading(me) ? (
          <RowsSkeleton />
        ) : null
      ) : (
        <SeasonContent season={season} data={own} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // отступ секции «Профиля» — у самого блока: скрытый блок места не оставляет
  block: { paddingTop: size.sectionGap, gap: space.s2 },
  own: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  ownText: { flex: 1, gap: space.s1 },
  start: { alignItems: 'flex-start' },
  race: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    borderTopWidth: stroke.hairline,
  },
  raceText: { flex: 1 },
});
