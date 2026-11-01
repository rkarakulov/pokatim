import {
  SOCIAL_HOME_RIDERS_MAX,
  SOCIAL_HOME_ROWS_MAX,
  type CatalogRouteCard,
  type SocialHome,
  type SocialHomeResultRow,
  type SocialHomeRider,
  type SocialHomeRideRow,
  type SocialHomeRouteRow,
} from '@pokatim/contracts';

import type { PublicRiderCard } from '../profile';
import type { SocialRaceResult } from '../results';
import type { SocialUpcomingRide } from '../rides';

/** «Свой» строки из публичной карточки (K3): только с `publicId`, без `userId`. */
export function homeRiderOf(card: PublicRiderCard): SocialHomeRider | null {
  if (card.publicId === null) return null;
  return {
    name: card.name,
    publicId: card.publicId,
    avatar: card.avatarId ? { id: card.avatarId } : null,
  };
}

/**
 * Строка райда (RC-P7-12): «свои» — участники райда из `friends` в порядке участников (организатор первым), первые
 * `SOCIAL_HOME_RIDERS_MAX`; остальные — числом. Райд без «своих» — без строки.
 */
export function rideRowOf(
  ride: SocialUpcomingRide,
  friends: ReadonlyMap<string, SocialHomeRider>,
): SocialHomeRideRow | null {
  const riders = ride.participantIds.flatMap((userId) => {
    const rider = friends.get(userId);
    return rider ? [rider] : [];
  });
  if (riders.length === 0) return null;
  return {
    kind: 'ride',
    ride: ride.card,
    riders: riders.slice(0, SOCIAL_HOME_RIDERS_MAX),
    othersCount: Math.max(0, riders.length - SOCIAL_HOME_RIDERS_MAX),
  };
}

/** Строка результата (RC-P7-13): разница — своё − зрителя (минус — «быстрее вас»), зрителя нет — `null`. */
export function resultRowOf(
  result: SocialRaceResult,
  friends: ReadonlyMap<string, SocialHomeRider>,
): SocialHomeResultRow | null {
  const rider = friends.get(result.userId);
  if (!rider) return null;
  return {
    kind: 'result',
    rider,
    race: { id: result.raceId, title: result.raceTitle },
    entryId: result.entryId,
    place: result.place,
    tied: result.tied,
    elapsedSec: result.elapsedSec,
    deltaSec: result.viewerElapsedSec === null ? null : result.elapsedSec - result.viewerElapsedSec,
  };
}

/** Строка маршрута (RC-P7-14): автор — «свой». */
export function routeRowOf(
  route: { card: CatalogRouteCard; authorUserId: string },
  friends: ReadonlyMap<string, SocialHomeRider>,
): SocialHomeRouteRow | null {
  const rider = friends.get(route.authorUserId);
  return rider ? { kind: 'route', rider, route: route.card } : null;
}

/**
 * Отбор ≤ `SOCIAL_HOME_ROWS_MAX` (RC-P7-12): по кругу видов в порядке K7 (ride → result → route) — первый каждого вида,
 * затем вторые, …; показ — сгруппировано в том же порядке видов. Кандидаты вида — уже в порядке сервера.
 */
export function pickHomeRows(candidates: {
  ride: readonly SocialHomeRideRow[];
  result: readonly SocialHomeResultRow[];
  route: readonly SocialHomeRouteRow[];
}): SocialHome['items'] {
  const kinds = [candidates.ride, candidates.result, candidates.route] as const;
  const taken = [0, 0, 0];
  let total = 0;
  for (let round = 0; total < SOCIAL_HOME_ROWS_MAX; round += 1) {
    let progressed = false;
    for (const [index, rows] of kinds.entries()) {
      if (total >= SOCIAL_HOME_ROWS_MAX) break;
      if (round < rows.length) {
        taken[index] = round + 1;
        total += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return [
    ...candidates.ride.slice(0, taken[0]),
    ...candidates.result.slice(0, taken[1]),
    ...candidates.route.slice(0, taken[2]),
  ];
}
