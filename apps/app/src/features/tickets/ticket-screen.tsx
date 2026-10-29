import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Banner, EmptyState, TextAction, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { ShellSkeleton } from '@/components/shell-skeleton';
import { apiErrorCode } from '@/features/auth/error-messages';
import { formatMinskDateTime } from '@/lib/minsk-format';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import type { OfflineTicket } from './offline-model';
import { useTicket } from './queries';
import { TicketDetails } from './ticket-details';
import { TicketSkeleton } from './ticket-skeleton';
import { useOfflineTicket } from './use-offline-ticket';

/** Нейтральный заголовок вкладки (без события, кода и ПДн): тот же, что `generateMetadata`. */
export const TICKET_DOCUMENT_TITLE = `${t('tickets.title')} — ${t('app.name')}`;

/** Офлайн-копия: баннер «Офлайн-копия от …» с повтором и билет. */
function OfflineCopy({ copy, retry }: { copy: OfflineTicket; retry?: () => void }) {
  const savedAt = formatMinskDateTime(new Date(copy.savedAt).toISOString(), null, 'short').full;
  return (
    <View style={styles.stack}>
      <View testID="ticket-offline-copy" style={styles.banner}>
        <Banner tone="warning" message={t('tickets.offline.banner', { date: savedAt })} />
        {retry ? (
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={retry} />
          </View>
        ) : null}
      </View>
      <TicketDetails view={copy.view} />
    </View>
  );
}

function NotFound() {
  const router = useRouter();
  return (
    <EmptyState
      title={t('tickets.notFound.title')}
      message={t('tickets.notFound.message')}
      action={{ label: t('tickets.notFound.action'), onPress: () => router.replace('/') }}
    />
  );
}

/**
 * Экран билета (`/tickets/<код>`, plan-B §2): запрос — только клиент и только вошедшему (`code` — канонический или
 * `null`, если адрес не код билета: «не найдено» без запроса). 404 (чужой и несуществующий неотличимы) — «Билет не
 * найден». Сеть или сбой без данных — офлайн-копия с баннером (AC12), иначе «Нет соединения» / «Не удалось
 * загрузить» с повтором (`AsyncContent`). `offlineOnly` — сессия не проверена (web без связи при запуске): запроса нет,
 * копия или ошибка оболочки с повтором восстановления.
 */
export function TicketScreen({
  code,
  offlineOnly = false,
  failure,
}: {
  code: string | null;
  offlineOnly?: boolean;
  failure?: { error: unknown; retry: () => void };
}) {
  const theme = useTheme();
  const ticket = useTicket(code ?? '', code !== null && !offlineOnly);
  const copy = useOfflineTicket(code ?? '', code !== null);
  const refetchers = useMemo(() => [ticket.refetch], [ticket.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  // 404 — авторитетный отказ: и при показанных данных (обновление) прежний билет с QR больше не показываем
  const notFound = code === null || apiErrorCode(ticket.error) === 'NOT_FOUND';
  const failedWithoutData =
    ticket.data === undefined && (ticket.isError || ticket.fetchStatus === 'paused');
  const retry = () => void ticket.refetch();

  if (offlineOnly && copy === null) return <ShellSkeleton failure={failure} />;

  let body;
  if (notFound) body = <NotFound />;
  else if (copy && (offlineOnly || failedWithoutData)) {
    body = <OfflineCopy copy={copy} retry={offlineOnly ? failure?.retry : retry} />;
  } else {
    body = (
      <AsyncContent query={ticket} skeleton={<TicketSkeleton />}>
        {(view) => <TicketDetails view={view} />}
      </AsyncContent>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={TICKET_DOCUMENT_TITLE} />
      <DetailHeader title={t('tickets.title')} fallback="/" />
      <ScrollView
        testID="ticket-screen"
        contentContainerStyle={styles.content}
        refreshControl={
          offlineOnly ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={theme.text.secondary}
              colors={[theme.text.primary]}
              progressBackgroundColor={theme.surface.raised}
            />
          )
        }
      >
        <OfflineBanner hasData={ticket.data !== undefined && !notFound} style={styles.banner} />
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  stack: { gap: space.s4 },
  banner: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
