import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { NO_FILTERS, type RaceFilters } from '@/features/races/filters';
import { useHeaderSeason } from '@/features/races/queries';
import { RaceFeed } from '@/features/races/race-feed';

const DOCUMENT_TITLE = `${t('races.title')} — ${t('app.name')}`;

/**
 * Вкладка «Гонки» (блок 03): список гонок платформы с фильтрами, герой, группы «Скоро» / «Завершённые», курсорная
 * подгрузка. Только для вошедших (как все вкладки); карточка гонки — публичный маршрут `/races/<id>`. Участие,
 * результаты скрыты (§4); «Таблица сезона» (race-results-08c) — на экран сезона кнопки шапки. Обновление — pull-to-refresh и фокус (`focusManager`).
 */
export default function RacesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [filters, setFilters] = useState<RaceFilters>(NO_FILTERS);
  // вход в сезон (Q3): текущий → ближайший предстоящий → последний завершённый; сезонов нет — кнопки нет
  const season = useHeaderSeason();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      <RaceFeed
        filters={filters}
        onFiltersChange={setFilters}
        header={
          <View style={styles.head}>
            <Text
              accessibilityRole="header"
              style={[textStyle('displayTitle'), styles.title, { color: theme.text.primary }]}
            >
              {t('races.title')}
            </Text>
            {season ? (
              <Button
                variant="secondary"
                label={season.name}
                onPress={() => router.push(`/seasons/${season.id}`)}
              />
            ) : null}
            {season ? (
              <View style={styles.table}>
                <TextAction
                  label={t('races.seasonTable')}
                  onPress={() => router.push(`/seasons/${season.id}`)}
                />
              </View>
            ) : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3,
  },
  title: { flexShrink: 1 },
  table: { flexBasis: '100%', alignItems: 'flex-start' },
});
