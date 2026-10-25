import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { NO_FILTERS, type RaceFilters } from '@/features/races/filters';
import { RaceFeed } from '@/features/races/race-feed';

const DOCUMENT_TITLE = `${t('races.title')} — ${t('app.name')}`;

/**
 * Вкладка «Гонки» (блок 03): список гонок платформы с фильтрами, герой, группы «Скоро» / «Завершённые», курсорная
 * подгрузка. Только для вошедших (как все вкладки); карточка гонки — публичный маршрут `/races/<id>`. Участие,
 * результаты и таблица сезона скрыты (§4). Обновление — pull-to-refresh и фокус (`focusManager`).
 */
export default function RacesScreen() {
  const theme = useTheme();
  const [filters, setFilters] = useState<RaceFilters>(NO_FILTERS);

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
  },
  title: { flexShrink: 1 },
});
