import { apiErrorOf } from '@pokatim/api-client';
import {
  CreateProfileReportRequest,
  PROFILE_REPORT_REASONS,
  RiderPublicId,
  type ProfileReportReason,
  type RiderProfileViewer,
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

import { riderReportErrorMessage } from './error-messages';
import { useReportRider, useRiderViewer } from './queries';

export const riderPath = (id: string) => `/riders/${encodeURIComponent(id)}`;

/** Ссылка «К профилю»: назад к профилю в стеке, без истории — заменить на профиль. */
function BackToRider({ id }: { id: string }) {
  const router = useRouter();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(riderPath(id));
  };
  return (
    <View style={styles.start}>
      <TextAction label={t('riders.report.back')} onPress={back} />
    </View>
  );
}

/** Ошибка поля комментария (схема контракта): код → текст `field.error.*`. */
function commentError(comment: string): string | undefined {
  const result = CreateProfileReportRequest.shape.comment.safeParse(comment);
  if (result.success) return undefined;
  const code = result.error.issues[0]?.message ?? 'INVALID';
  const key = `field.error.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('field.error.INVALID') : text;
}

/**
 * Форма жалобы (как у маршрута, routes-06): причина — одна из справочника (обязательна), комментарий ≤ 500 —
 * необязательно. После отправки — баннер успеха и «К профилю» на месте формы. Уже жаловался — «Вы пожаловались…»;
 * нельзя (свой профиль) — «На этот профиль нельзя пожаловаться».
 */
function ReportForm({ id, viewer }: { id: string; viewer: RiderProfileViewer }) {
  const theme = useTheme();
  const report = useReportRider(id);
  const [reason, setReason] = useState<ProfileReportReason>();
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const fieldError = commentError(comment);

  const submit = async () => {
    if (!reason || fieldError) return;
    const body = CreateProfileReportRequest.parse({ reason, comment });
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
        <Banner message={t('riders.report.sent')} />
        <BackToRider id={id} />
      </View>
    );
  }
  if (viewer.reported || !viewer.canReport) {
    return (
      <View style={styles.stack}>
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t(viewer.reported ? 'riders.report.reported' : 'riders.report.unavailable')}
        </Text>
        <BackToRider id={id} />
      </View>
    );
  }
  return (
    <View style={styles.form}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('riders.report.reason')}
      </Text>
      <View style={styles.chips}>
        {PROFILE_REPORT_REASONS.map((value) => (
          <Chip
            key={value}
            label={domainLabel('domain.profileReportReason', value) ?? value}
            selected={reason === value}
            onPress={() => setReason(value)}
          />
        ))}
      </View>
      <TextField
        label={t('riders.report.comment')}
        value={comment}
        onChangeText={setComment}
        error={fieldError}
      />
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('riders.report.hint')}
      </Text>
      {report.error ? (
        <Banner tone="error" message={riderReportErrorMessage(report.error)} />
      ) : null}
      <Button
        label={t('riders.report.submit')}
        loading={report.isPending}
        disabled={!reason || fieldError !== undefined || report.isPending}
        onPress={() => void submit()}
      />
    </View>
  );
}

/**
 * «Пожаловаться на профиль» (`/riders/report/<publicId>`, profile-report-app) — внутри `Stack.Protected`. Право жалобы
 * решает сервер (`GET /v1/riders/:publicId/me`). Имени, клуба и фото на экране и в заголовке документа нет (D-B2).
 * Невалидный id и 404 (профиль скрыт) — «Профиль недоступен»; загрузка и ошибки — `AsyncContent`.
 */
export function RiderReportScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = RiderPublicId.safeParse(id).success;
  const viewer = useRiderViewer(id, valid);
  const notFound = !valid || apiErrorOf(viewer.error)?.code === 'NOT_FOUND';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('riders.report.title')} — ${t('app.name')}`} />
      <DetailHeader title={t('riders.report.title')} fallback={valid ? riderPath(id) : '/'} />
      <ScrollView
        testID="rider-report"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {notFound ? (
          <EmptyState
            title={t('riders.notFound')}
            message={t('riders.notFoundBody')}
            action={{ label: t('riders.home'), onPress: () => router.navigate('/') }}
          />
        ) : (
          <AsyncContent query={viewer} skeleton={<SkeletonHeroCard />}>
            {(data: RiderProfileViewer) => <ReportForm id={id} viewer={data} />}
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
