import { Uuid } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { EmptyState, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { CardPanel } from '@/features/sharing/card-panel';

import { useRide, useRideForViewer } from '../queries';
import { ridePath, rideInviteSource } from './ride-invite';
import { RidePhotoSection } from './ride-photo-section';

/**
 * Карточка-приглашение кофе-райда (`/rides/invite/<райд>`, внутри `Stack.Protected`): общая панель карточки
 * (`CardPanel`, рендер сервера ADR-0018). Не будущий (409), скрытый и неизвестный (404) — «Приглашение недоступно» и
 * «К райду». Права — только сервер. Организатору с правом правки (`viewer` из `me`) — блок «Своё фото» под карточкой
 * (ride-photo P3); остальным — без него.
 */
export function RideInviteScreen({ rideId }: { rideId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(rideId).success;
  const ride = useRide(rideId, undefined, valid);
  const me = useRideForViewer(rideId, valid).data;
  // организатор с правом правки (будущий опубликованный, не скрытый) — решает сервер
  const managed = me?.viewer.role === 'organizer' && me.viewer.canManage ? me : null;
  const source = useMemo(() => rideInviteSource(rideId), [rideId]);
  // «К райду» — к детали этого райда в стеке (как «К гонке»), не на произвольный предыдущий экран
  const back = () => (valid ? router.dismissTo(ridePath(rideId)) : router.navigate('/rides'));
  const empty = (
    <EmptyState
      title={t('rideInvite.empty.title')}
      message={t('rideInvite.empty.message')}
      action={{ label: t('rideInvite.empty.action'), onPress: back }}
    />
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('rideInvite.title')} — ${t('app.name')}`} />
      <DetailHeader title={t('rideInvite.title')} fallback={valid ? ridePath(rideId) : '/rides'} />
      <ScrollView testID="ride-invite" contentContainerStyle={styles.content}>
        {valid ? (
          <View style={styles.stack}>
            <CardPanel
              source={source}
              enabled={valid}
              previewLabel={t('rideInvite.preview', {
                ride: ride.data?.title ?? t('rideInvite.title'),
              })}
              shareTitle={t('rideInvite.title')}
              hint={t('rideInvite.hint')}
              empty={empty}
              emptyOnNotFound
            />
            {managed ? <RidePhotoSection rideId={rideId} photo={managed.ride.photo} /> : null}
          </View>
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
  stack: { gap: space.s6 },
});
