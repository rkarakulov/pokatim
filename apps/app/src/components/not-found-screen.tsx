import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { EmptyState, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from './document-title';

/**
 * «Страница не найдена» (`+not-found`, B1 смоука dev): неизвестный адрес и dev-маршруты в production (`/ui-kit`).
 * «На главную» — `/`: гостю дальше решает гард корневого layout. SSR отдаёт этот экран с кодом 404.
 */
export function NotFoundScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface.default }]}>
      <DocumentTitle title={`${t('notFound.title')} — ${t('app.name')}`} />
      <View style={styles.content}>
        <EmptyState
          title={t('notFound.title')}
          message={t('notFound.message')}
          action={{ label: t('notFound.home'), onPress: () => router.replace('/') }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingTop: space.s6 },
});
