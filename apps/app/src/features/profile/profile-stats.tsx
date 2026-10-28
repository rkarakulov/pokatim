import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, SkeletonGroup, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { StatBlock } from '@/components/stat-block';

import { RaceHistoryRow } from './history-rows';
import { bestPlaceRow, ownStatItems } from './profile-format';
import type { useProfileStats } from './queries';

/**
 * Статистика своего профиля (rider-profile): `StatBlock` — заезды, км, набор, гонки в зачёте, подиумы, лучшее место;
 * нули — это данные, не пустое состояние. Под блоком — «Лучшие места» (до трёх, строки ведут в гонку). Первая
 * загрузка — скелетон строки цифр; ошибки — `AsyncContent`.
 */
export function ProfileStats({ query }: { query: ReturnType<typeof useProfileStats> }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View testID="profile-stats">
      <AsyncContent
        query={query}
        skeleton={
          <SkeletonGroup>
            <SkeletonText variant="displayStat" lines={2} lastLineWidth="70%" />
          </SkeletonGroup>
        }
      >
        {(stats) => (
          <View style={styles.stack}>
            <StatBlock items={ownStatItems(stats)} />
            {stats.bestPlaces.length > 0 ? (
              <View>
                <Text
                  accessibilityRole="header"
                  style={[textStyle('label'), { color: theme.text.secondary }]}
                >
                  {t('profile.stats.bestPlaces')}
                </Text>
                {stats.bestPlaces.map((best) => {
                  const row = bestPlaceRow(best);
                  return (
                    <RaceHistoryRow
                      key={row.raceId}
                      row={row}
                      onPress={() => router.push(`/races/${row.raceId}`)}
                    />
                  );
                })}
              </View>
            ) : null}
          </View>
        )}
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s4 },
});
