import type { RouteRideLeaderboard } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { RiderWho, TableRow, useRowAction } from '@/features/races/table-row';
import { meta } from '@/lib/minsk-format';

import {
  leaderboardMeView,
  leaderboardRowView,
  ownInRows,
  routeRidePath,
  type OthersRowView,
} from './route-ride-format';

/**
 * Строка таблицы «Другие» (route-rides-04): место, кто, время и день. Своя — «Вы» с полосой (как своя строка таблицы
 * результатов), кнопка к своему заезду, без согласия — подпись «Видно только вам»; чужая публичная — ссылка на профиль;
 * «Участник» — без нажатия. `separated` — своя строка вне списка (отделена сверху).
 */
function OthersRowItem({
  view,
  routeId,
  rideId,
  riderPublicId,
  avatarId,
  onlyYou,
  separated,
}: {
  view: OthersRowView;
  routeId: string;
  rideId: string | null;
  riderPublicId: string | null;
  avatarId: string | null;
  onlyYou: boolean;
  separated: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const note = onlyYou ? t('routes.others.onlyYou') : undefined;
  const action = useRowAction(
    rideId !== null && view.ownA11y !== null
      ? {
          label: meta([view.ownA11y, note ?? null]),
          onPress: () => router.push(routeRidePath(routeId, rideId, false)),
        }
      : null,
    riderPublicId,
    view.profileA11y,
  );
  return (
    <TableRow
      a11y={view.a11y}
      action={action}
      style={[
        styles.row,
        { borderTopColor: separated ? theme.border.strong : theme.border.subtle },
        separated ? styles.separated : null,
        // полоса — роль рамки (акцентной рамки в системе нет); «Вы» — текстом, не только цветом
        view.own ? [styles.own, { borderLeftColor: theme.border.strong }] : null,
      ]}
    >
      <Text style={[textStyle('time'), styles.place, { color: theme.text.primary }]}>
        {view.place}
      </Text>
      <RiderWho
        who={view.who}
        own={view.own}
        riderPublicId={riderPublicId}
        avatarId={avatarId}
        note={note}
      />
      <View style={styles.end}>
        <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{view.day}</Text>
      </View>
    </TableRow>
  );
}

/** «Включить показ» (RC-B4): согласие — только в форме профиля с текстом пояснения. */
export function EnableShareAction() {
  const router = useRouter();
  return (
    <View style={styles.start}>
      <TextAction
        label={t('routes.others.enable')}
        onPress={() => router.push('/settings/profile')}
      />
    </View>
  );
}

/**
 * Строки таблицы «Другие» (блок карточки и полный список): строки сервера; своя вне списка (`me`, RC-B1) — отдельной
 * строкой под ним; без согласия — «Включить показ». Пусто (`rows` и `me` нет) — текст. Клиент ничего не ранжирует и
 * не фильтрует.
 */
export function OthersRows({
  data,
  routeId,
  now,
}: {
  data: RouteRideLeaderboard;
  routeId: string;
  now: Date | null;
}) {
  const theme = useTheme();
  if (data.rows.length === 0 && data.me === null) {
    return (
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('routes.others.empty')}
      </Text>
    );
  }
  const ownListed = ownInRows(data.rows);
  const me = !ownListed ? data.me : null;
  const onlyYou = !data.shared;
  return (
    <View style={styles.stack}>
      <View>
        {data.rows.map((row) => (
          <OthersRowItem
            key={row.place}
            view={leaderboardRowView(row, now)}
            routeId={routeId}
            rideId={row.rideId}
            riderPublicId={row.riderPublicId}
            avatarId={row.riderAvatar?.id ?? null}
            onlyYou={onlyYou && row.rideId !== null}
            separated={false}
          />
        ))}
        {me ? (
          <OthersRowItem
            view={leaderboardMeView(me, now)}
            routeId={routeId}
            rideId={me.rideId}
            riderPublicId={null}
            avatarId={null}
            onlyYou={onlyYou}
            separated={data.rows.length > 0}
          />
        ) : null}
      </View>
      {onlyYou && (ownListed || data.me !== null) ? <EnableShareAction /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
  // строка может быть кнопкой или ссылкой — не ниже минимальной цели касания
  row: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    borderTopWidth: stroke.hairline,
  },
  // своя строка вне списка: разделитель толще и отступ сверху
  separated: { marginTop: space.s2, borderTopWidth: stroke.indicator },
  own: { borderLeftWidth: stroke.indicator, paddingLeft: space.s2 },
  // колонка мест одной ширины: токен ширины короткого числового значения
  place: { minWidth: size.skeletonWord },
  end: { alignItems: 'flex-end' },
});
