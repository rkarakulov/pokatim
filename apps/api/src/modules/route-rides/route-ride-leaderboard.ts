import { minskToday, type RouteRideLeaderboard } from '@pokatim/contracts';

import { type PublicRiderCard, riderRowFields } from '../profile';
import { compareRides } from './route-rides.policy';

/** Один из лучших пройденных заездов райдера маршрута (агрегат `RouteRidesRepository.leaderboardTop`). */
export interface TopRide {
  id: string;
  activityId: string;
  elapsedSec: number;
  startedAt: Date;
}

/** Строка ранжирования таблицы «Другие»: райдер и его лучший живой пройденный заезд. */
export interface LeaderboardEntry {
  userId: string;
  rideId: string;
  elapsedSec: number;
  startedAt: Date;
}

/** Первый живой из лучших заездов райдера (уже в порядке `compareRides`); живых нет — `undefined`. */
export function firstAlive(
  top: readonly TopRide[],
  live: ReadonlySet<string>,
): TopRide | undefined {
  return top.find((ride) => live.has(ride.activityId));
}

const keyOf = (entry: LeaderboardEntry) => ({
  elapsedSec: entry.elapsedSec,
  startedAt: entry.startedAt,
  id: entry.rideId,
});

/**
 * Таблица «Другие» (route-rides-04, O3/O4, RC-3): райдеры с согласием и зритель (`me`, если есть живой пройденный
 * заезд) — в одном списке по `compareRides`, места 1…n уникальные (без «=N»); `rows` — первые `limit`, `total` — n.
 * Поля строки — явным литералом: имя, ссылка и фото — `riderRowFields` карточки (P1/R4), `rideDate` — день по Минску
 * без времени суток, `rideId` — только у своей строки. `userId` и id активности наружу не выходят.
 */
export function rankLeaderboard(input: {
  others: readonly LeaderboardEntry[];
  me: LeaderboardEntry | null;
  cards: ReadonlyMap<string, PublicRiderCard>;
  limit: number;
  shared: boolean;
}): RouteRideLeaderboard {
  const { me } = input;
  const ranked = [...input.others, ...(me ? [me] : [])].sort((a, b) =>
    compareRides(keyOf(a), keyOf(b)),
  );
  const isMe = (entry: LeaderboardEntry) => me !== null && entry === me;
  const mePlace = me ? ranked.indexOf(me) + 1 : 0;
  return {
    rows: ranked.slice(0, input.limit).map((entry, index) => ({
      place: index + 1,
      elapsedSec: entry.elapsedSec,
      rideDate: minskToday(entry.startedAt),
      ...riderRowFields(input.cards.get(entry.userId)),
      rideId: isMe(entry) ? entry.rideId : null,
    })),
    total: ranked.length,
    me: me
      ? {
          place: mePlace,
          elapsedSec: me.elapsedSec,
          rideDate: minskToday(me.startedAt),
          rideId: me.rideId,
        }
      : null,
    shared: input.shared,
  };
}
