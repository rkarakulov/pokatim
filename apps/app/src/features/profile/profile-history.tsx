import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SegmentedControl, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { HistoryList, RaceHistoryRow, RideHistoryRow } from './history-rows';
import { ownRaceRow, rideRow } from './profile-format';
import type { useProfileRaces, useProfileRides } from './queries';

export type HistoryTab = 'races' | 'rides';

/**
 * «История» своего профиля (rider-profile, AC13): вкладки «Гонки» / «Райды» (`SegmentedControl`, состояние экрана).
 * Запрос — только у выбранной вкладки (экран держит `enabled`): «Райды» грузятся при первом переключении. Гонка →
 * `/races/<id>`, райд → `/rides/<id>`; пусто — пустое состояние со ссылкой на вкладку раздела.
 */
export function ProfileHistory({
  tab,
  onTabChange,
  races,
  rides,
}: {
  tab: HistoryTab;
  onTabChange: (tab: HistoryTab) => void;
  races: ReturnType<typeof useProfileRaces>;
  rides: ReturnType<typeof useProfileRides>;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), { color: theme.text.primary }]}
      >
        {t('profile.history.title')}
      </Text>
      <SegmentedControl<HistoryTab>
        segments={[
          { key: 'races', label: t('profile.history.races') },
          { key: 'rides', label: t('profile.history.rides') },
        ]}
        selected={tab}
        onChange={onTabChange}
      />
      {tab === 'races' ? (
        <HistoryList
          testID="profile-history-races"
          query={races}
          failure={t('state.failedMessage')}
          empty={{
            title: t('profile.history.racesEmpty'),
            action: {
              label: t('profile.history.allRaces'),
              onPress: () => router.navigate('/races'),
            },
          }}
          renderRow={(item) => {
            const row = ownRaceRow(item);
            return (
              <RaceHistoryRow
                key={row.raceId}
                row={row}
                onPress={() => router.push(`/races/${row.raceId}`)}
              />
            );
          }}
        />
      ) : (
        <HistoryList
          testID="profile-history-rides"
          query={rides}
          failure={t('state.failedMessage')}
          empty={{
            title: t('profile.history.ridesEmpty'),
            action: {
              label: t('profile.history.allRides'),
              onPress: () => router.navigate('/rides'),
            },
          }}
          renderRow={(item) => {
            const row = rideRow(item);
            return (
              <RideHistoryRow
                key={row.rideId}
                title={row.title}
                details={row.details}
                a11y={row.a11y}
                onPress={() => router.push(`/rides/${row.rideId}`)}
              />
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
});
