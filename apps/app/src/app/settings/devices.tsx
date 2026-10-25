import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  EmptyState,
  SectionHeader,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { DeviceRow } from '@/features/devices/device-row';
import { useDevices, useTrackUploads } from '@/features/devices/queries';
import { TrackUploadBlock } from '@/features/devices/track-upload-block';
import { UploadRow } from '@/features/devices/upload-row';
import { useHomeClock } from '@/features/home/use-home-clock';
import { usePullToRefresh } from '@/features/home/use-pull-to-refresh';

const DOCUMENT_TITLE = `${t('devices.title')} — ${t('app.name')}`;

function RowsSkeleton() {
  return (
    <SkeletonGroup>
      <SkeletonListRow />
      <SkeletonListRow />
    </SkeletonGroup>
  );
}

/**
 * «Устройства» (вход — иконка верхней панели): подключения Garmin/Wahoo через агрегатор, ручная загрузка FIT/GPX и
 * последние 20 загрузок. Заголовок и шапки разделов — сразу; данные — `AsyncContent` по разделам (скелетон, «Нет
 * соединения» / «Не удалось загрузить» с повтором, баннер при ошибке обновления). Обновление — pull-to-refresh и фокус
 * (`focusManager`); опрос — только пока есть незавершённые загрузки.
 */
export default function DevicesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const devices = useDevices();
  const uploads = useTrackUploads();
  const refetchers = useMemo(
    () => [devices.refetch, uploads.refetch],
    [devices.refetch, uploads.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  // «сейчас» подписей дат (год — только не текущий): с новыми данными, фокусом и в полночь по Минску
  const now = useHomeClock([devices.dataUpdatedAt, uploads.dataUpdatedAt]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView
        testID="devices-screen"
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
        <View style={styles.back}>
          <TextAction label={t('devices.back')} onPress={back} />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('devices.title')}
        </Text>

        <View style={styles.section}>
          <SectionHeader
            kicker={t('devices.providers.kicker')}
            title={t('devices.providers.title')}
          />
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('devices.syncHint')}
          </Text>
          <AsyncContent
            query={devices}
            skeleton={<RowsSkeleton />}
            empty={{
              when: (list) => list.items.length === 0,
              render: () => (
                <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
                  {t('devices.empty')}
                </Text>
              ),
            }}
          >
            {(list) => (
              <View>
                {list.items.map((device, index) => (
                  <DeviceRow
                    key={device.provider === 'unknown' ? `unknown-${index}` : device.provider}
                    device={device}
                    now={now}
                    first={index === 0}
                  />
                ))}
              </View>
            )}
          </AsyncContent>
        </View>

        <View style={[styles.section, styles.divided, { borderTopColor: theme.border.subtle }]}>
          <SectionHeader kicker={t('tracks.upload.kicker')} title={t('tracks.upload.title')} />
          <TrackUploadBlock uploads={uploads.data?.items} />
        </View>

        <View style={[styles.section, styles.divided, { borderTopColor: theme.border.subtle }]}>
          <SectionHeader kicker={t('tracks.recent.kicker')} title={t('tracks.recent.title')} />
          <AsyncContent
            query={uploads}
            skeleton={<RowsSkeleton />}
            empty={{
              when: (page) => page.items.length === 0,
              render: () => <EmptyState title={t('tracks.recent.empty')} />,
            }}
          >
            {(page) => (
              <View>
                {page.items.map((upload, index) => (
                  <UploadRow key={upload.id} upload={upload} now={now} first={index === 0} />
                ))}
              </View>
            )}
          </AsyncContent>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s3 },
  back: { alignItems: 'flex-start' },
  section: { paddingTop: size.sectionGap, gap: space.s3 },
  divided: { borderTopWidth: stroke.hairline, marginTop: space.s3 },
});
