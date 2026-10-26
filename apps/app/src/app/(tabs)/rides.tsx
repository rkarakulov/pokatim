import { t } from '@pokatim/i18n';
import { useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { NO_FILTERS, type RideFilters } from '@/features/rides/filters';
import { RideFeed } from '@/features/rides/ride-feed';

const DOCUMENT_TITLE = `${t('rides.title')} — ${t('app.name')}`;

/**
 * Вкладка «Райды» (блок 05): ближайшие кофе-райды по времени старта, фильтр «Город», герой «Ближайший райд», список
 * по дням, «Я иду» прямо в ленте. Только для вошедших (лента зависит от зрителя); карточка — публичный маршрут
 * `/rides/<id>`. «Рядом», карта и фото — скрыты (§4). Обновление — pull-to-refresh, фокус, мутации.
 */
export default function RidesScreen() {
  const theme = useTheme();
  const [filters, setFilters] = useState<RideFilters>(NO_FILTERS);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      <RideFeed filters={filters} onFiltersChange={setFilters} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
});
