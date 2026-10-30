import { Uuid } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { EmptyState, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { CardPanel } from '@/features/sharing/card-panel';

import { useCatalogRoute } from '../queries';
import { routePath } from '../route-detail';
import { routeStorySource } from './route-story';

/**
 * Карточка маршрута каталога для сторис (`/routes/story/<маршрут>`, внутри `Stack.Protected`): общая панель карточки
 * (`CardPanel`, рендер сервера ADR-0018). Маршрут не в каталоге (404) и кривой id — «Карточка недоступна» и
 * «К маршруту». Права — только сервер.
 */
export function RouteStoryScreen({ routeId }: { routeId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(routeId).success;
  const route = useCatalogRoute(routeId, undefined, valid);
  const source = useMemo(() => routeStorySource(routeId), [routeId]);
  // «К маршруту» — к карточке этого маршрута в стеке, не на произвольный предыдущий экран
  const back = () => (valid ? router.dismissTo(routePath(routeId)) : router.navigate('/routes'));
  const empty = (
    <EmptyState
      title={t('routeCard.empty.title')}
      message={t('routeCard.empty.message')}
      action={{ label: t('routeCard.empty.action'), onPress: back }}
    />
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('routeCard.title')} — ${t('app.name')}`} />
      <DetailHeader
        title={t('routeCard.title')}
        fallback={valid ? routePath(routeId) : '/routes'}
      />
      <ScrollView testID="route-story" contentContainerStyle={styles.content}>
        {valid ? (
          <CardPanel
            source={source}
            enabled={valid}
            previewLabel={t('routeCard.preview', {
              route: route.data?.title ?? t('routeCard.kicker'),
            })}
            shareTitle={t('routeCard.title')}
            hint={t('routeCard.hint')}
            empty={empty}
            emptyOnNotFound
          />
        ) : (
          empty
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
});
