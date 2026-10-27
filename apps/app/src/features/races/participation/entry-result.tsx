import type { MyRaceEntry, RaceDetail } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Pill, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { minskDateTime } from '@/lib/minsk-format';

import { entryTierLine, resultBanner, resultElapsed, resultPill } from '../participation-format';

/**
 * Результат участника (§7.2): плашка статуса, «Ваше время» крупно (`provisional`), баннер места или «Место появится
 * после проверки.». Всё — из `result` сервера. Смена баннера читается скринридером (`polite`), без уведомлений (D-37).
 * Дата протокола — после монтирования (`now`), год — только если не текущий.
 */
export function EntryResult({
  entry,
  race,
  now,
}: {
  entry: MyRaceEntry;
  race: RaceDetail;
  now: Date | null;
}) {
  const theme = useTheme();
  const pill = resultPill(entry.result.status);
  const elapsed = resultElapsed(entry.result);
  const tierLine = entryTierLine(entry);
  const banner =
    entry.result.status === 'pending' || now !== null
      ? resultBanner(
          entry.result,
          now === null ? '' : minskDateTime(race.protocolPlannedAt, now).date,
        )
      : null;

  return (
    <View style={styles.result}>
      {tierLine ? (
        <Text style={[textStyle('label'), { color: theme.text.primary }]}>{tierLine}</Text>
      ) : null}
      {pill ? (
        <View style={styles.pill}>
          <Pill label={pill.label} tone={pill.tone} />
        </View>
      ) : null}
      {elapsed ? (
        <View style={styles.time}>
          <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
            {t('races.result.yourTime')}
          </Text>
          <Text style={[textStyle('displayNumeral36'), { color: theme.text.primary }]}>
            {elapsed}
          </Text>
        </View>
      ) : null}
      <View accessibilityLiveRegion="polite">
        {banner ? <Banner tone={banner.tone} message={banner.message} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  result: { gap: space.s3 },
  pill: { alignItems: 'flex-start' },
  time: { gap: space.s1 },
});
