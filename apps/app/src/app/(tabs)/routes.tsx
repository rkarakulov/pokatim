import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SegmentedControl, textStyle, useTheme } from '@rkarakulov/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { NO_FILTERS, type RouteFilters } from '@/features/routes/filters';
import { MyRouteFeed } from '@/features/routes/my-route-feed';
import { RouteFeed } from '@/features/routes/route-feed';

const DOCUMENT_TITLE = `${t('routes.title')} — ${t('app.name')}`;

type RoutesView = 'catalog' | 'mine';

const SEGMENTS = [
  { key: 'catalog', label: t('routes.switch.catalog') },
  { key: 'mine', label: t('routes.switch.mine') },
] as const;

/**
 * Вкладка «Маршруты»: переключатель «Каталог / Мои» (routes-02, M1, RC-13) — состояние в `?view=mine` (возврат с
 * карточки и перезагрузка web сохраняют «Мои»). «Каталог» (routes-01) — маршруты команды с фильтрами города,
 * дистанции и покрытия; «Мои» — свои маршруты райдера с загрузкой GPX/KML, без фильтров каталога. Только для
 * вошедших (как все вкладки). Обновление — pull-to-refresh и фокус (`focusManager`).
 */
export default function RoutesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const view: RoutesView = params.view === 'mine' ? 'mine' : 'catalog';
  const [filters, setFilters] = useState<RouteFilters>(NO_FILTERS);

  const header = (
    <View style={styles.header}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displayTitle'), { color: theme.text.primary }]}
      >
        {t('routes.title')}
      </Text>
      <View accessibilityLabel={t('routes.switch.label')}>
        <SegmentedControl<RoutesView>
          segments={SEGMENTS}
          selected={view}
          onChange={(next) => router.setParams({ view: next === 'mine' ? 'mine' : undefined })}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      {view === 'mine' ? (
        <MyRouteFeed header={header} />
      ) : (
        <RouteFeed filters={filters} onFiltersChange={setFilters} header={header} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { gap: space.s3 },
});
