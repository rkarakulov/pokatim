import type { MySeasonStandings, SeasonCard, SeasonStandingCell } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useHeaderSeason } from '@/features/races/queries';
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

/**
 * Блок «Сезон» «Профиля» (race-results-08c, RC-18): сезон — тот же, что кнопка вкладки «Гонки» (`useHeaderSeason`).
 * Своя строка (место, очки, «{группа} · {класс}»), «Вся таблица» → экран сезона, гонки своей таблицы. Сезона нет или
 * своих строк нет — блок скрыт; ошибка без данных — компактный баннер с повтором (§4.12).
 */
export function ProfileSeasonBlock() {
  const season = useHeaderSeason();
  const me = useMySeasonStandings(season?.id ?? '', season !== null);
  if (!season) return null;
  if (me.data !== undefined && me.data.items.length === 0) return null;
  return <SeasonSection season={season} me={me} />;
}

function SeasonSection({
  season,
  me,
}: {
  season: SeasonCard;
  me: ReturnType<typeof useMySeasonStandings>;
}) {
  const theme = useTheme();
  return (
    <View testID="profile-season" style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), { color: theme.text.primary }]}
      >
        {t('profile.season.title')}
      </Text>
      <TabFailure query={me} message={t('profile.season.failed')} />
      {me.data === undefined ? (
        loading(me) ? (
          <RowsSkeleton />
        ) : null
      ) : (
        <SeasonContent season={season} data={me.data} />
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
