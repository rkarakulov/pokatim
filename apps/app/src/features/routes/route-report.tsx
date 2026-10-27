import { apiErrorOf } from '@pokatim/api-client';
import {
  CreateRouteReportRequest,
  ROUTE_REPORT_REASONS,
  Uuid,
  type CatalogRouteViewer,
  type RouteReportReason,
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
  SkeletonText,
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

import { routeReportErrorMessage } from './error-messages';
import { useCatalogRoute, useCatalogRouteViewer, useReportCatalogRoute } from './queries';
import { routePath } from './route-detail';

/** Ссылка «К маршруту»: назад к карточке в стеке, без истории — заменить на карточку. */
function BackToRoute({ id }: { id: string }) {
  const router = useRouter();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(routePath(id));
  };
  return (
    <View style={styles.start}>
      <TextAction label={t('routes.report.back')} onPress={back} />
    </View>
  );
}

/** Ошибка поля комментария (схема контракта): код → текст `field.error.*`. */
function commentError(comment: string): string | undefined {
  const result = CreateRouteReportRequest.shape.comment.safeParse(comment);
  if (result.success) return undefined;
  const code = result.error.issues[0]?.message ?? 'INVALID';
  const key = `field.error.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('field.error.INVALID') : text;
}

/**
 * Форма жалобы (как у райда, 05b): причина — одна из справочника (обязательна), комментарий ≤ 500 — необязательно.
 * После отправки — баннер успеха и «К маршруту» на месте формы. Уже жаловался — «Вы пожаловались…»; нельзя (свой,
 * команды) — «На этот маршрут нельзя пожаловаться».
 */
function ReportForm({ id, viewer }: { id: string; viewer: CatalogRouteViewer }) {
  const theme = useTheme();
  const report = useReportCatalogRoute(id);
  const [reason, setReason] = useState<RouteReportReason>();
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const fieldError = commentError(comment);

  const submit = async () => {
    if (!reason || fieldError) return;
    const body = CreateRouteReportRequest.parse({ reason, comment });
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
        <Banner message={t('routes.report.sent')} />
        <BackToRoute id={id} />
      </View>
    );
  }
  if (viewer.reported || !viewer.canReport) {
    return (
      <View style={styles.stack}>
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t(viewer.reported ? 'routes.report.reported' : 'routes.report.unavailable')}
        </Text>
        <BackToRoute id={id} />
      </View>
    );
  }
  return (
    <View style={styles.form}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('routes.report.reason')}
      </Text>
      <View style={styles.chips}>
        {ROUTE_REPORT_REASONS.map((value) => (
          <Chip
            key={value}
            label={domainLabel('domain.routeReportReason', value) ?? value}
            selected={reason === value}
            onPress={() => setReason(value)}
          />
        ))}
      </View>
      <TextField
        label={t('routes.report.comment')}
        value={comment}
        onChangeText={setComment}
        error={fieldError}
      />
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('routes.report.hint')}
      </Text>
      {report.error ? (
        <Banner tone="error" message={routeReportErrorMessage(report.error)} />
      ) : null}
      <Button
        label={t('routes.report.submit')}
        loading={report.isPending}
        disabled={!reason || fieldError !== undefined || report.isPending}
        onPress={() => void submit()}
      />
    </View>
  );
}

/**
 * «Пожаловаться на маршрут» (`/routes/report/<id>`, routes-06, A4) — внутри `Stack.Protected`. Право жалобы решает
 * сервер (`GET /v1/routes/:id/me` → `canReport`/`reported`); название — из карточки каталога. Невалидный id и 404
 * (снят, скрыт, не в каталоге) — «Маршрут недоступен»; загрузка и ошибки — `AsyncContent`: права (`me`) — всего
 * экрана, карточки — своим блоком на месте названия (скелетон, ошибка с повтором, баннер при ошибке обновления).
 */
export function RouteReportScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const viewer = useCatalogRouteViewer(id, valid);
  const route = useCatalogRoute(id, undefined, valid);
  const notFound =
    !valid ||
    apiErrorOf(viewer.error)?.code === 'NOT_FOUND' ||
    apiErrorOf(route.error)?.code === 'NOT_FOUND';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('routes.report.title')} — ${t('app.name')}`} />
      <DetailHeader title={t('routes.report.title')} fallback={valid ? routePath(id) : '/routes'} />
      <ScrollView
        testID="route-report"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {notFound ? (
          <EmptyState
            title={t('routes.detail.notFound')}
            action={{
              label: t('routes.detail.allRoutes'),
              onPress: () => router.navigate('/routes'),
            }}
          />
        ) : (
          <AsyncContent query={viewer} skeleton={<SkeletonHeroCard />}>
            {(data: CatalogRouteViewer) => (
              <View style={styles.form}>
                <AsyncContent
                  query={route}
                  skeleton={
                    <View testID="route-report-title-skeleton">
                      <SkeletonText variant="titleSm" lines={1} lastLineWidth="60%" />
                    </View>
                  }
                >
                  {(detail) => (
                    <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
                      {detail.title}
                    </Text>
                  )}
                </AsyncContent>
                <ReportForm id={id} viewer={data} />
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
