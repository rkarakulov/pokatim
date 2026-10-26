import { apiErrorOf } from '@pokatim/api-client';
import {
  CreateRideReportRequest,
  RIDE_REPORT_REASONS,
  type RideReportReason,
  type RideView,
  Uuid,
} from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  Chip,
  EmptyState,
  SkeletonHeroCard,
  TextAction,
  TextField,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { domainLabel } from '@/lib/minsk-format';

import { rideReportErrorText, useReportRide, useRideForViewer } from './queries';

const ridePath = (id: string) => `/rides/${id}`;

/** Ссылка «К райду»: назад к карточке в стеке, без истории — заменить на карточку. */
function BackToRide({ id }: { id: string }) {
  const router = useRouter();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(ridePath(id));
  };
  return (
    <View style={styles.start}>
      <TextAction label={t('rides.report.back')} onPress={back} />
    </View>
  );
}

/** Ошибка поля комментария (схема контракта): код → текст `field.error.*`. */
function commentError(comment: string): string | undefined {
  const result = CreateRideReportRequest.shape.comment.safeParse(comment);
  if (result.success) return undefined;
  const code = result.error.issues[0]?.message ?? 'INVALID';
  const key = `field.error.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('field.error.INVALID') : text;
}

/**
 * Форма жалобы: причина — выбор одной из справочника (обязательна), комментарий — необязательно. После отправки —
 * баннер успеха и «К райду» на месте формы (без параметров навигации, 8.1 D11).
 */
function ReportForm({ view }: { view: RideView }) {
  const theme = useTheme();
  const { ride } = view;
  const report = useReportRide(ride.id);
  const [reason, setReason] = useState<RideReportReason>();
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const fieldError = commentError(comment);

  const submit = async () => {
    if (!reason || fieldError) return;
    const body = CreateRideReportRequest.parse({ reason, comment });
    try {
      await report.mutateAsync({ reason: body.reason, comment: body.comment ?? null });
    } catch {
      return; // текст отказа — из `report.error`
    }
    setSent(true);
  };

  if (sent) {
    return (
      <View style={styles.stack}>
        <Banner message={t('rides.report.sent')} />
        <BackToRide id={ride.id} />
      </View>
    );
  }
  if (view.viewer.reported || !view.viewer.canReport) {
    return (
      <View style={styles.stack}>
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t(view.viewer.reported ? 'rides.detail.reported' : 'rides.report.unavailable')}
        </Text>
        <BackToRide id={ride.id} />
      </View>
    );
  }
  return (
    <View style={styles.form}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('rides.report.reason')}
      </Text>
      <View style={styles.chips}>
        {RIDE_REPORT_REASONS.map((value) => (
          <Chip
            key={value}
            label={domainLabel('domain.rideReportReason', value) ?? value}
            selected={reason === value}
            onPress={() => setReason(value)}
          />
        ))}
      </View>
      <TextField
        label={t('rides.report.comment')}
        value={comment}
        onChangeText={setComment}
        error={fieldError}
      />
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('rides.report.hint')}
      </Text>
      {report.error ? <Banner tone="error" message={rideReportErrorText(report.error)} /> : null}
      <Button
        label={t('rides.report.submit')}
        loading={report.isPending}
        disabled={!reason || fieldError !== undefined || report.isPending}
        onPress={() => void submit()}
      />
    </View>
  );
}

/**
 * «Пожаловаться на райд» (`/rides/report/<id>`, 05b): состояние зрителя — `me` (кнопку и право жалобы решает
 * сервер: `canReport`/`reported`). Невалидный id и 404 — «Райд не найден»; загрузка и ошибки — `AsyncContent`.
 */
export function RideReportScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const me = useRideForViewer(id, valid, { manage: true });
  const notFound = !valid || apiErrorOf(me.error)?.code === 'NOT_FOUND';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('rides.report.title')} — ${t('app.name')}`} />
      <DetailHeader title={t('rides.report.title')} fallback={valid ? ridePath(id) : '/rides'} />
      <ScrollView
        testID="ride-report"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {notFound ? (
          <EmptyState
            title={t('rides.detail.notFound')}
            action={{
              label: t('rides.detail.allRides'),
              onPress: () => router.navigate('/rides'),
            }}
          />
        ) : (
          <AsyncContent query={me} skeleton={<SkeletonHeroCard />}>
            {(view: RideView) => (
              <View style={styles.form}>
                <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
                  {view.ride.title}
                </Text>
                <ReportForm view={view} />
              </View>
            )}
          </AsyncContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  form: { gap: space.s4 },
  stack: { gap: space.s2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
