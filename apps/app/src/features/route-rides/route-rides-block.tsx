import { isNetworkError } from '@pokatim/api-client';
import type { RouteRidePage, RouteRideRow } from '@pokatim/contracts';
import { motion, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  Button,
  Kicker,
  Pill,
  SkeletonGroup,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  routeRidePath,
  routeRidePickPath,
  routeRideRowView,
  routeRidesSummary,
  VISIBLE_ROWS,
} from './route-ride-format';

function Block({ children }: { children: ReactNode }) {
  return (
    <View testID="route-rides" style={styles.block}>
      {children}
    </View>
  );
}

/** Строка своего заезда: статус, «Лучший», время у пройденного, дата и источник; нажатие — результат. */
function RouteRideRowItem({
  row,
  routeId,
  mine,
  now,
}: {
  row: RouteRideRow;
  routeId: string;
  mine: boolean;
  now: Date | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const view = routeRideRowView(row, now);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={view.a11y}
      onPress={() => router.push(routeRidePath(routeId, row.id, mine))}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: theme.border.subtle, opacity: pressed ? motion.pressedOpacity : 1 },
      ]}
    >
      <View style={styles.pills}>
        <Pill label={view.pill.label} tone={view.pill.tone} />
        {view.best ? <Pill label={t('races.attempt.best')} tone="accent" /> : null}
      </View>
      {view.time ? (
        <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
      ) : null}
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{view.meta}</Text>
    </Pressable>
  );
}

/**
 * Блок «Мои заезды» на карточке маршрута (route-rides-02, A2): только вошедшему и только на клиенте — `rides: null`
 * (гость, SSR, сессия неизвестна) — ничего. Сводка или подсказка, «Проверить свой заезд», строки новых сверху (5 и
 * «Показать все (N)» на месте). Состояния §4.12: первая загрузка — скелетон; ошибка без данных — баннер с повтором;
 * ошибка обновления — строки и баннер; 404 (маршрут стал невидим) — ничего. Опрос — у запроса (RC-5).
 */
export function RouteRidesBlock({
  routeId,
  mine,
  rides,
  now,
}: {
  routeId: string;
  /** свой маршрут — `?mine=1` в адресах выбора и результата (A5) */
  mine: boolean;
  rides: UseQueryResult<RouteRidePage | null> | null;
  now: Date | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  if (rides === null) return null;

  const data = rides.data;
  if (data === undefined) {
    if (rides.isError) {
      return (
        <Block>
          <Kicker label={t('routes.rides.kicker')} />
          <Banner
            tone="warning"
            title={t(isNetworkError(rides.error) ? 'state.errorTitle' : 'state.failedTitle')}
            message={t('routes.rides.failed')}
          />
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={() => void rides.refetch()} />
          </View>
        </Block>
      );
    }
    return (
      <View testID="route-rides-skeleton">
        <SkeletonGroup>
          <SkeletonText variant="body" lines={2} lastLineWidth="60%" />
        </SkeletonGroup>
      </View>
    );
  }
  if (data === null) return null;

  const summary = routeRidesSummary(data.summary);
  const rows = expanded ? data.items : data.items.slice(0, VISIBLE_ROWS);
  const hidden = data.items.length - rows.length;
  return (
    <Block>
      <Kicker label={t('routes.rides.kicker')} />
      {rides.isError ? (
        <View style={styles.stack}>
          <Banner tone="warning" title={t('state.staleTitle')} message={t('state.staleMessage')} />
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={() => void rides.refetch()} />
          </View>
        </View>
      ) : null}
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {summary ?? t('routes.rides.emptyHint')}
      </Text>
      <Button
        label={t('routes.rides.check')}
        variant="secondary"
        onPress={() => router.push(routeRidePickPath(routeId, mine))}
      />
      {rows.length > 0 ? (
        <View>
          {rows.map((row) => (
            <RouteRideRowItem key={row.id} row={row} routeId={routeId} mine={mine} now={now} />
          ))}
        </View>
      ) : null}
      {hidden > 0 ? (
        <View style={styles.start}>
          <TextAction
            label={t('routes.rides.showAll', { count: data.items.length })}
            onPress={() => setExpanded(true)}
          />
        </View>
      ) : null}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
  row: { gap: space.s1, paddingVertical: space.s3, borderTopWidth: stroke.hairline },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
