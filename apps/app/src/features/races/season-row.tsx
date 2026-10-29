import type { SeasonCard } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text } from 'react-native';

import { domainLabel, formatLocalRange, heroDateText, meta } from '@/lib/minsk-format';

/** Даты сезона по Минску — всегда с годом (публичный экран, SSR): «1 апреля–31 октября 2026». */
export const seasonDates = (season: SeasonCard) =>
  heroDateText(formatLocalRange(season.startsOn, season.endsOn, null));

/** Метка фазы сезона (фаза — с сервера; `'unknown'` — без метки). */
export const seasonPhaseLabel = (season: SeasonCard) =>
  domainLabel('domain.seasonPhase', season.phase);

/**
 * Строка-ссылка сезона: название, «даты · фаза»; для скринридера — «название. даты. фаза». «Другие сезоны» экрана
 * сезона и раздел «Сезон» гостевого лендинга.
 */
export function SeasonLinkRow({ season, onPress }: { season: SeasonCard; onPress: () => void }) {
  const theme = useTheme();
  const phase = seasonPhaseLabel(season);
  const dates = seasonDates(season);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[season.name, dates, phase].filter(Boolean).join('. ')}
      onPress={onPress}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{season.name}</Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {meta([dates, phase])}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: stroke.hairline, paddingVertical: space.s3, gap: space.s1 },
});
