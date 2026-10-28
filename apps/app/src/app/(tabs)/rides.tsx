import { t } from '@pokatim/i18n';
import { useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { NO_FILTERS, type RideFilters } from '@/features/rides/filters';
import { RideFeed, type RideFeedView } from '@/features/rides/ride-feed';
import { useNear } from '@/features/rides/use-near';

const DOCUMENT_TITLE = `${t('rides.title')} — ${t('app.name')}`;

/**
 * Вкладка «Райды» (блок 05): ближайшие кофе-райды по времени старта, фильтр «Город», герой «Ближайший райд», список
 * по дням, «Я иду» прямо в ленте. Только для вошедших (лента зависит от зрителя); карточка — публичный маршрут
 * `/rides/<id>`. 05c: «Список / Карта» и «Рядом» — состояние экрана (позиция «Рядом» — только в памяти, не в URL);
 * фото — скрыто (§4). Обновление — pull-to-refresh, фокус, мутации.
 */
export default function RidesScreen() {
  const theme = useTheme();
  const [filters, setFilters] = useState<RideFilters>(NO_FILTERS);
  const [view, setView] = useState<RideFeedView>('list');
  const near = useNear();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      <RideFeed
        filters={filters}
        onFiltersChange={setFilters}
        view={view}
        onViewChange={setView}
        near={near}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
});
