import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { NO_FILTERS, type RouteFilters } from '@/features/routes/filters';
import { RouteFeed } from '@/features/routes/route-feed';

const DOCUMENT_TITLE = `${t('routes.title')} — ${t('app.name')}`;

/**
 * Вкладка «Маршруты» (routes-01): каталог маршрутов команды с фильтрами города, дистанции и покрытия, курсорная
 * подгрузка. Только для вошедших (как все вкладки, RC-9); карточка маршрута — публичный маршрут `/routes/<id>`.
 * Обновление — pull-to-refresh и фокус (`focusManager`).
 */
export default function RoutesScreen() {
  const theme = useTheme();
  const [filters, setFilters] = useState<RouteFilters>(NO_FILTERS);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      <RouteFeed
        filters={filters}
        onFiltersChange={setFilters}
        header={
          <Text
            accessibilityRole="header"
            style={[textStyle('displayTitle'), { color: theme.text.primary }]}
          >
            {t('routes.title')}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
});
