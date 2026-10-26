import type { MyAttempt, MyRaceEntry, RaceDetail } from '@pokatim/contracts';
import { space, themes, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Chip, SkeletonGroup, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatMinskDateTime } from '@/features/devices/format';
import { MAP_ASPECT_RATIO } from '@/features/maps/corridor-style';
import { mapStyleUrl } from '@/features/maps/map-style';
import { mapSupported } from '@/features/maps/map-support';
import { RouteMap } from '@/features/maps/route-map';
import type { RouteMapTrack } from '@/features/maps/track-style';
import { formatDistances } from '@/lib/minsk-format';
import { useMounted } from '@/lib/use-minsk-clock';

import { myTrackLines, myTrackMapLabel, pickTrackAttempt } from './my-track-format';
import { useMyAttemptTrack, useRaceRoute } from './queries';

const NO_ATTEMPTS: readonly MyAttempt[] = [];

/**
 * Карта маршрута с коридором на карточке гонки (maps-01, ADR-0014). Без коридора — ничего. SSR и первый клиентский
 * рендер — место карты (скелетон той же пропорции, RC-2): env стиля и геометрия известны только после монтирования.
 * Затем: env не задан, нативного модуля карты нет, геометрия 404 или ошибка — блок схлопывается (строки «Коридор» и дистанция остаются);
 * иначе — карта по теме приложения.
 *
 * maps-02: участнику с попытками — свой трек выбранной попытки (по умолчанию лучшая, иначе новая; переключатель —
 * чипы при нескольких), легенда и текстовая альтернатива подсветки под картой и в подписи карты. Гостю и не
 * заявленному — без трека и без запроса. Пока впервые грузится трек — скелетон на месте карты (карта не монтируется дважды, RC-5; чипы остаются); ошибка
 * трека — карта маршрута и строка с повтором; легенда «пунктир» — только при участках схода; 404 трека — карта без трека и без строки (RC-8).
 */
export function RaceRouteMap({
  race,
  entry = null,
  now = null,
}: {
  race: RaceDetail;
  /** «моё участие» вошедшего; гостю — `null` */
  entry?: MyRaceEntry | null;
  /** «сейчас» после монтирования — дата заезда в чипах */
  now?: Date | null;
}) {
  const theme = useTheme<AppTheme>();
  const mounted = useMounted();
  const corridor = race.corridor ?? null;
  // нет нативного модуля (Expo Go, старый dev-клиент) — как env не задан
  const styleUrl = mounted && mapSupported() ? mapStyleUrl(theme === themes.dark) : null;
  const route = useRaceRoute(race.id, Boolean(corridor) && styleUrl !== null);
  const widthM = corridor?.widthM;
  // ширина коридора на карте — из карточки, как в строке «Коридор» и подписи (один источник после правки гонки)
  const map = useMemo(
    () => (route.data && widthM !== undefined ? { ...route.data, widthM } : null),
    [route.data, widthM],
  );

  const attempts = entry?.attempts ?? NO_ATTEMPTS;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const attempt = pickTrackAttempt(attempts, selectedId);
  const trackQuery = useMyAttemptTrack(race.id, attempt, map !== null && styleUrl !== null);
  const data = trackQuery.data ?? null;
  const track = useMemo<RouteMapTrack | undefined>(
    () => (data ? { line: data.line, segment: data.segment, offRuns: data.offRuns } : undefined),
    [data],
  );

  if (!corridor) return null;
  // ошибка без данных — блока нет; ошибка обновления при показанной карте — карта остаётся (§4.12)
  if (mounted && (styleUrl === null || (route.isError && !route.data))) return null;
  const skeleton = (
    <SkeletonGroup>
      <View style={[styles.place, { backgroundColor: theme.surface.skeleton }]} />
    </SkeletonGroup>
  );
  if (!map || styleUrl === null) return skeleton;
  // первая загрузка трека — скелетон только на месте карты (чипы и строки остаются: фокус не теряется); после первой
  // ошибки (и при «Повторить» — `refetch` сбрасывает `failureCount`) — карта маршрута без трека
  const trackPending =
    trackQuery.isLoading && trackQuery.failureCount === 0 && trackQuery.errorUpdateCount === 0;

  const mapLabel = t('races.detail.map.label', {
    distance: formatDistances([race.distanceKm]) ?? '',
    width: corridor.widthM,
  });
  const lines = attempt && data ? myTrackLines(attempt, data.marks, data.offRuns.length) : [];
  const secondary = [textStyle('meta'), { color: theme.text.secondary }];
  return (
    <View style={styles.block}>
      {trackPending ? (
        skeleton
      ) : (
        <RouteMap
          // смена стиля (темы) — новая карта: сброс ошибки прошлого стиля; смена рамки (другой маршрут коридора) — тоже:
          // native-камера применяет `initialViewState` один раз; смена попытки или её ревизии — новая карта (RC-5)
          key={[
            styleUrl,
            map.bounds.join(','),
            track && attempt ? `${attempt.id}|${attempt.status}|${attempt.checkedAt ?? ''}` : '',
          ].join('|')}
          map={map}
          styleUrl={styleUrl}
          theme={theme}
          accessibilityLabel={lines.length > 0 ? myTrackMapLabel(mapLabel, lines) : mapLabel}
          failedMessage={t('races.detail.map.failed')}
          track={track}
        />
      )}
      {track && data ? (
        <Text style={secondary}>
          {data.marks === 'ready' && data.offRuns.length > 0
            ? `${t('races.detail.myTrack.legendTrack')} · ${t('races.detail.myTrack.legendOff')}`
            : t('races.detail.myTrack.legendTrack')}
        </Text>
      ) : null}
      {lines.map((line) => (
        <Text key={line} style={[textStyle('body'), { color: theme.text.primary }]}>
          {line}
        </Text>
      ))}
      {trackQuery.isError && !data ? (
        <View testID="my-track-error" style={styles.error}>
          <Text style={secondary}>{t('races.detail.myTrack.failed')}</Text>
          <TextAction label={t('state.retry')} onPress={() => void trackQuery.refetch()} />
        </View>
      ) : null}
      {attempts.length > 1 && attempt ? (
        // роль radio у `Chip` — задача в app-foundation (RC-9); группа — radiogroup с подписью
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('races.detail.myTrack.attempts')}
          testID="my-track-attempts"
          style={styles.chips}
        >
          {attempts.map((item) => {
            const status = t(`races.attempt.status.${item.status}`);
            return (
              <Chip
                key={item.id}
                label={
                  now === null
                    ? status
                    : t('races.detail.myTrack.attemptChip', {
                        date: formatMinskDateTime(item.activity.startedAt, now),
                        status,
                      })
                }
                selected={item.id === attempt.id}
                onPress={() => setSelectedId(item.id)}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  place: { width: '100%', aspectRatio: MAP_ASPECT_RATIO },
  block: { gap: space.s2 },
  error: { gap: space.s1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
