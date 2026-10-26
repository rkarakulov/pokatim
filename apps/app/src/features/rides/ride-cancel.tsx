import {
  RIDE_CANCEL_REASONS,
  type RideCancelReason,
  type RideDetailForOrganizer,
} from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Chip, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { domainLabel } from '@/lib/minsk-format';

import { rideActionErrorText, useCancelRide } from './queries';

/**
 * «Отменить райд» (Q6): причина из справочника обязательна (без свободного текста), destructive-действие выключено,
 * пока причина не выбрана; пояснение — участники увидят отмену и причину. После — карточка с баннером отмены.
 */
export function RideCancelScreen({ ride }: { ride: RideDetailForOrganizer }) {
  const theme = useTheme();
  const router = useRouter();
  const cancel = useCancelRide(ride.id);
  const [reason, setReason] = useState<RideCancelReason>();

  const submit = async () => {
    if (!reason) return;
    try {
      await cancel.mutateAsync({ reason });
    } catch {
      return; // текст отказа — из `cancel.error`
    }
    // назад к карточке (она уже в стеке и обновлена инвалидацией), без истории — заменить на карточку
    if (router.canGoBack()) router.back();
    else router.replace(`/rides/${ride.id}`);
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('rides.cancel.title')} — ${t('app.name')}`} />
      <DetailHeader title={t('rides.cancel.title')} fallback={`/rides/${ride.id}`} />
      <ScrollView testID="ride-cancel" contentContainerStyle={styles.content}>
        <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{ride.title}</Text>
        <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
          {t('rides.cancel.reason')}
        </Text>
        <View style={styles.chips}>
          {RIDE_CANCEL_REASONS.map((value) => (
            <Chip
              key={value}
              label={domainLabel('domain.rideCancelReason', value) ?? value}
              selected={reason === value}
              onPress={() => setReason(value)}
            />
          ))}
        </View>
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t('rides.cancel.hint')}
        </Text>
        {cancel.error ? (
          <Banner tone="error" message={rideActionErrorText(cancel.error, ride.limit)} />
        ) : null}
        <View style={styles.start}>
          <TextAction
            label={t('rides.cancel.submit')}
            destructive
            disabled={!reason || cancel.isPending}
            onPress={() => void submit()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
