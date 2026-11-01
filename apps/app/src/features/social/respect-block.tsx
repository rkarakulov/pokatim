import type { RespectState } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { apiErrorOf } from '@pokatim/api-client';
import { AsyncContent, Banner, Button, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RideRiderList } from '@/features/rides/ride-rider-list';

import { socialActionErrorText } from './queries';
import {
  useRaceEntryRespect,
  useRouteRespect,
  useSetRaceEntryRespect,
  useSetRouteRespect,
} from './respect-queries';

type SetRespect = ReturnType<typeof useSetRouteRespect>;

/** Отказ «Респекта» у кнопки: лимит — общий текст «Свои», остальное — свой. */
const respectErrorText = (error: unknown) =>
  apiErrorOf(error)?.code === 'RATE_LIMITED'
    ? socialActionErrorText(error)
    : t('social.respect.error.unknown');

/** Состояние респекта: первая загрузка — однострочный скелетон; ошибка без данных — `AsyncContent` с повтором. */
function RespectAsync({
  query,
  testID,
  children,
}: {
  query: UseQueryResult<RespectState>;
  testID: string;
  children: (data: RespectState) => ReactNode;
}) {
  return (
    <AsyncContent
      query={query}
      skeleton={
        <View testID={`${testID}-skeleton`}>
          <SkeletonText variant="body" lines={1} lastLineWidth="40%" />
        </View>
      }
    >
      {children}
    </AsyncContent>
  );
}

/** Переключатель «Респект» с ошибкой у кнопки (лимит — свой текст). */
function ToggleButton({
  label,
  respected,
  mutation,
}: {
  label: string;
  respected: boolean;
  mutation: SetRespect;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.start}>
        <Button
          label={label}
          variant={respected ? 'secondary' : 'primary'}
          loading={mutation.isPending}
          onPress={() => mutation.mutate(!respected)}
        />
      </View>
      {mutation.error ? <Banner tone="warning" message={respectErrorText(mutation.error)} /> : null}
    </View>
  );
}

/**
 * «Респект» чужой строке результата гонки (P4, K8): «Респект» / «Респект · N» — повтор снимает. Нет цели (снятая,
 * DQ, финишёр — `available: false`) — ничего; число — только здесь, не в таблице (K14).
 */
export function RespectButton({ raceId, entryId }: { raceId: string; entryId: string }) {
  const query = useRaceEntryRespect(raceId, entryId, true);
  const mutation = useSetRaceEntryRespect(raceId, entryId);
  return (
    <RespectAsync query={query} testID="respect">
      {(data) =>
        data.available ? (
          <ToggleButton
            label={
              data.count > 0
                ? t('social.respect.withCount', { count: data.count })
                : t('social.respect.action')
            }
            respected={data.respected}
            mutation={mutation}
          />
        ) : null
      }
    </RespectAsync>
  );
}

/** Своя строка результата (P4, Q4): «респект N» и поставившие — публичные строками, остальные числом; нет — ничего. */
export function RespectReceived({ raceId, entryId }: { raceId: string; entryId: string }) {
  const theme = useTheme();
  const query = useRaceEntryRespect(raceId, entryId, true);
  return (
    <RespectAsync query={query} testID="respect-received">
      {(data) =>
        data.own && data.count > 0 ? (
          <View testID="respect-received" style={styles.stack}>
            <Text style={[textStyle('label'), { color: theme.text.primary }]}>
              {t('social.respect.received', { count: data.count })}
            </Text>
            {data.from ? <RideRiderList group={data.from} /> : null}
          </View>
        ) : null
      }
    </RespectAsync>
  );
}

/**
 * «Респект автору» после «Маршрут пройден» (P4, K8): только при `available` (свой маршрут — `own`, маршрут команды —
 * нейтральный ответ). Число автору — только в уведомлении (P7, Q4).
 */
export function RouteAuthorRespect({ routeId }: { routeId: string }) {
  const query = useRouteRespect(routeId, true);
  const mutation = useSetRouteRespect(routeId);
  return (
    <RespectAsync query={query} testID="route-respect">
      {(data) =>
        data.available ? (
          <ToggleButton
            label={t('social.respect.author')}
            respected={data.respected}
            mutation={mutation}
          />
        ) : null
      }
    </RespectAsync>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
