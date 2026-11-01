import type { SocialConnectionRow, SocialConnections } from '@pokatim/contracts';
import { motion, size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  EmptyState,
  SkeletonText,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { RiderAvatar } from '@/components/rider-avatar';
import { riderPath } from '@/features/riders/queries';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import {
  socialActionErrorText,
  socialKey,
  useSetRiderConnection,
  useSocialConnections,
} from './queries';
import { CONNECT_LABELS, connectionRowText } from './social-format';

const DOCUMENT_TITLE = `${t('social.title')} — ${t('app.name')}`;
const SKELETON_ROWS = 3;

/**
 * Строка «Свои»: аватар, имя, подпись по полям сервера; нажатие — профиль райдера. «Убрать из своих» — без
 * подтверждения, строка остаётся с «В свои» (можно вернуть) — локальное состояние экрана до ухода.
 */
function ConnectionRow({
  row,
  now,
  removed,
  onToggled,
}: {
  row: SocialConnectionRow;
  now: Date;
  removed: boolean;
  onToggled: (removed: boolean) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const mutation = useSetRiderConnection(row.publicId, { refreshList: false });
  const note = connectionRowText(row, now);
  const connected = !removed;
  return (
    <View
      testID={`social-row-${row.publicId}`}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <View style={styles.rowLine}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={note ? `${row.name}. ${note}` : row.name}
          onPress={() => router.push(riderPath(row.publicId))}
          style={({ pressed }) => [styles.who, { opacity: pressed ? motion.pressedOpacity : 1 }]}
        >
          <RiderAvatar avatarId={row.avatar?.id ?? null} dimension={size.avatarTopBar} decorative />
          <View style={styles.text}>
            <Text numberOfLines={1} style={[textStyle('label'), { color: theme.text.primary }]}>
              {row.name}
            </Text>
            {note ? (
              <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{note}</Text>
            ) : null}
          </View>
        </Pressable>
        <Button
          label={t(connected ? 'social.connected' : 'social.connect')}
          reserveLabels={CONNECT_LABELS}
          variant={connected ? 'secondary' : 'primary'}
          loading={mutation.isPending}
          onPress={() =>
            mutation.mutate(!connected, { onSuccess: (view) => onToggled(!view.connected) })
          }
        />
      </View>
      {mutation.error ? (
        <Banner tone="warning" message={socialActionErrorText(mutation.error)} />
      ) : null}
    </View>
  );
}

function ConnectionsSkeleton() {
  return (
    <View testID="social-skeleton" style={styles.list}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <SkeletonText key={index} variant="body" lines={2} lastLineWidth="50%" />
      ))}
    </View>
  );
}

function ConnectionsList({ data }: { data: SocialConnections }) {
  const now = useMinskClock([]);
  // убранные на этом экране (по publicId): строка остаётся с «В свои» до ухода (K1, без подтверждения)
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((publicId: string, isRemoved: boolean) => {
    setRemoved((current) => {
      const next = new Set(current);
      if (isRemoved) next.add(publicId);
      else next.delete(publicId);
      return next;
    });
  }, []);
  return (
    <View style={styles.list}>
      {data.items.map((row) => (
        <ConnectionRow
          key={row.publicId}
          row={row}
          now={now}
          removed={removed.has(row.publicId)}
          onToggled={(isRemoved) => toggle(row.publicId, isRemoved)}
        />
      ))}
    </View>
  );
}

/**
 * Экран «Свои» (`/social`, P3, K6): список связей вошедшего — только публичные профили, порядок — сервера. Уход с
 * экрана (blur, unmount) инвалидирует `['social']`: «Свои · N» в профиле и убранные строки обновятся. Пусто —
 * пояснение, откуда берутся свои.
 */
export function SocialScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const connections = useSocialConnections();
  // версия ответа сервера: новый ответ сбрасывает «убранные на экране» (вернули из профиля — снова в «своих»)
  const listVersion = connections.dataUpdatedAt;
  useFocusEffect(
    useCallback(
      () => () => void queryClient.invalidateQueries({ queryKey: socialKey }),
      [queryClient],
    ),
  );
  const refetchers = useMemo(() => [connections.refetch], [connections.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <DetailHeader title={t('social.title')} fallback="/profile" />
      <ScrollView
        testID="social-screen"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.text.secondary}
            colors={[theme.text.primary]}
            progressBackgroundColor={theme.surface.raised}
          />
        }
      >
        <AsyncContent
          query={connections}
          skeleton={<ConnectionsSkeleton />}
          empty={{
            when: (data) => data.items.length === 0,
            render: () => (
              <EmptyState title={t('social.empty.title')} message={t('social.empty.message')} />
            ),
          }}
        >
          {(data) => <ConnectionsList key={listVersion} data={data} />}
        </AsyncContent>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  list: { gap: space.s3 },
  row: {
    minHeight: size.rowMin,
    paddingTop: space.s3,
    borderTopWidth: stroke.hairline,
    gap: space.s2,
  },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  text: { flex: 1 },
});
