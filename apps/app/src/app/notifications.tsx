import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  SkeletonGroup,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { notificationTargetPath } from '@/features/notifications/notification-target';
import {
  NotificationRow,
  NotificationRowSkeleton,
} from '@/features/notifications/notification-row';
import { PushPermissionRow } from '@/features/notifications/push-permission-row';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/queries';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

const DOCUMENT_TITLE = `${t('notifications.title')} — ${t('app.name')}`;
const SKELETON_ROWS = [0, 1, 2, 3];

/**
 * «Уведомления» (центр, N9; вход — колокольчик Главной и push без цели): новые сверху, непрочитанные выделены.
 * Нажатие — прочитано и переход к объекту из белого списка целей (N10); «Прочитать все»; строка включения push
 * (native, N5); вход в настройки. Гард и оболочка — как у «Профиля». Состояния — `AsyncContent`, ошибка догрузки
 * страницы — баннер в подвале.
 */
export default function NotificationsScreen() {
  const shell = useSettingsShell();
  return shell ?? <NotificationsContent />;
}

function NotificationsContent() {
  const theme = useTheme();
  const router = useRouter();
  const { list, loadMore } = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const now = useMinskClock([list.dataUpdatedAt]);
  const refetchers = useMemo(() => [list.refetch, unread.refetch], [list.refetch, unread.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const items = (list.data?.pages ?? []).flatMap((page) => page.items);
  const hasUnread = (unread.data?.count ?? 0) > 0 || items.some((item) => !item.read);
  const listState = { ...list, isError: list.isError && !list.isFetchNextPageError };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const open = (id: string, read: boolean, target: unknown) => {
    if (!read) markRead.mutate(id);
    const path = notificationTargetPath(target);
    if (path) router.push(path);
  };

  const header = (
    <View style={styles.header}>
      <DocumentTitle title={DOCUMENT_TITLE} />
      <View style={styles.start}>
        <TextAction label={t('notifications.back')} onPress={back} />
      </View>
      <Text
        accessibilityRole="header"
        style={[textStyle('displayTitle'), { color: theme.text.primary }]}
      >
        {t('notifications.title')}
      </Text>
      <View style={styles.actions}>
        <TextAction
          label={t('notifications.readAll')}
          onPress={() => markAll.mutate()}
          disabled={!hasUnread || markAll.isPending}
        />
        <TextAction
          label={t('notifications.settingsLink')}
          onPress={() => router.push('/settings/notifications')}
        />
      </View>
      {markAll.isError ? <Banner tone="error" message={t('notifications.readAllFailed')} /> : null}
      {markRead.isError ? <Banner tone="error" message={t('notifications.openFailed')} /> : null}
      <PushPermissionRow />
      <OfflineBanner hasData={list.data !== undefined} />
      <AsyncContent
        query={listState}
        skeleton={
          <SkeletonGroup>
            {SKELETON_ROWS.map((index) => (
              <NotificationRowSkeleton key={index} />
            ))}
          </SkeletonGroup>
        }
        empty={{
          when: (data) => (data.pages[0]?.items.length ?? 0) === 0,
          render: () => (
            <EmptyState
              title={t('notifications.empty')}
              message={t('notifications.emptyMessage')}
            />
          ),
        }}
      >
        {() => null}
      </AsyncContent>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {list.isFetchNextPageError && list.data ? (
        <View style={styles.footerError}>
          <Banner
            tone="warning"
            title={t('state.failedTitle')}
            message={t('state.failedMessage')}
          />
          <TextAction label={t('state.retry')} onPress={() => void list.fetchNextPage()} />
        </View>
      ) : list.isFetchingNextPage ? (
        <SkeletonGroup>
          <NotificationRowSkeleton />
        </SkeletonGroup>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <FlatList
        testID="notifications-screen"
        contentContainerStyle={styles.content}
        data={list.data ? items : []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.text.secondary}
            colors={[theme.text.primary]}
            progressBackgroundColor={theme.surface.raised}
          />
        }
        renderItem={({ item }) => (
          <NotificationRow
            notification={item}
            now={now}
            onPress={() => open(item.id, item.read, item.target)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  header: { gap: space.s3, paddingBottom: space.s3 },
  start: { alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s4 },
  footer: { paddingBottom: space.s6 },
  footerError: { gap: space.s3, paddingTop: space.s3 },
});
