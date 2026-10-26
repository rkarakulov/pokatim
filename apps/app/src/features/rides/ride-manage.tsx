import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type RideDetailForOrganizer } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, EmptyState, SkeletonHeroCard, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';

import { useRideForViewer } from './queries';

/**
 * Загрузка своего райда для правки и отмены: `me` (роль и `version` с сервера). Не организатор, прошёл или отменён
 * (`canManage` — сервер), невалидный id и 404 — «Райд не найден». Скелетон и ошибки — `AsyncContent`.
 */
export function OwnRide({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: (
    ride: RideDetailForOrganizer,
    reload: () => Promise<RideDetailForOrganizer | undefined>,
  ) => ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const me = useRideForViewer(id, valid);
  const [managed, setManaged] = useState<boolean>();
  const reload = async () => {
    const result = await me.refetch();
    const ride = result.data?.ride;
    return ride && 'version' in ride ? ride : undefined;
  };
  const notFound = (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DetailHeader title={title} fallback="/rides" />
      <View style={styles.content}>
        <EmptyState
          title={t('rides.detail.notFound')}
          action={{ label: t('rides.detail.allRides'), onPress: () => router.navigate('/rides') }}
        />
      </View>
    </SafeAreaView>
  );
  if (!valid || apiErrorOf(me.error)?.code === 'NOT_FOUND') return notFound;
  if (me.data) {
    const { ride, viewer } = me.data;
    // права — по первому ответу: после своей отмены `canManage` гаснет, а экран должен успеть уйти на карточку
    const allowed = managed ?? viewer.canManage;
    if (managed === undefined) setManaged(viewer.canManage);
    return allowed && 'version' in ride ? children(ride, reload) : notFound;
  }
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DetailHeader title={title} fallback="/rides" />
      <View style={styles.content}>
        <AsyncContent query={me} skeleton={<SkeletonHeroCard />}>
          {() => null}
        </AsyncContent>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
});
