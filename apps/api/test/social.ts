import { productEventsCollections } from '../src/modules/product-events/product-events.collection';
import { SocialAttendanceService } from '../src/modules/social/attendance.service';
import { SocialConnectionsService } from '../src/modules/social/connections.service';
import { SocialReactionsService } from '../src/modules/social/reactions.service';
import { socialCollections } from '../src/modules/social/social.collection';
import { DAY, HOUR, type Harness } from './harness';
import { createRide, join, type Rider, rider, startsIn } from './rides';

/** Стенд «Свои» (ADR-0027): коллекции модуля, журнал метрик и сервисы ядра из графа worker. */
export const socialDb = (h: Harness) => ({
  ...socialCollections(h.db),
  events: productEventsCollections(h.db).events,
});

export const socialServices = (h: Harness) => ({
  connections: h.worker.get(SocialConnectionsService),
  attendance: h.worker.get(SocialAttendanceService),
  reactions: h.worker.get(SocialReactionsService),
});

/** Райдеры стенда `<name>@example.by` — по одному на имя, в том же порядке. */
export async function riders<const N extends readonly string[]>(
  h: Harness,
  ...names: N
): Promise<{ [K in keyof N]: Rider }> {
  const list: Rider[] = [];
  for (const name of names) list.push(await rider(h, `${name}@example.by`));
  return list as { [K in keyof N]: Rider };
}

/**
 * Будущие райды организатора: `count` райдов со стартом через 1, 2, … суток, участники отмечаются «Иду». Часы стенда
 * не двигаются — сдвиг после создания (`travelPast`): access-токены райдеров потом истекают, сервисы их не требуют.
 */
export async function ridesAhead(
  h: Harness,
  organizer: Rider,
  participants: readonly Rider[],
  count: number,
): Promise<{ id: string; startsAt: Date }[]> {
  const rides: { id: string; startsAt: Date }[] = [];
  for (let index = 1; index <= count; index += 1) {
    const ride = await createRide(h, organizer, {
      limit: null,
      startsAt: startsIn(h, index * DAY),
    });
    for (const who of participants) {
      const res = await join(h, who, ride.id);
      if (res.status !== 200) throw new Error(`join: ${res.status}`);
    }
    rides.push({ id: ride.id, startsAt: new Date(ride.startsAt) });
  }
  return rides;
}

/** Часы стенда — на `afterStartMs` за старт райда (вперёд). */
export function travelPast(h: Harness, startsAt: Date, afterStartMs = HOUR): void {
  h.clock.advance(startsAt.getTime() + afterStartMs - h.clock.now().getTime());
}

/** Прошедший райд: `ridesAhead` с одним райдом и сдвиг часов на `afterStartMs` за старт (по умолчанию — час). */
export async function pastRide(
  h: Harness,
  organizer: Rider,
  participants: readonly Rider[],
  afterStartMs = HOUR,
): Promise<{ id: string; startsAt: Date }> {
  const [ride] = await ridesAhead(h, organizer, participants, 1);
  if (!ride) throw new Error('нет райда');
  travelPast(h, ride.startsAt, afterStartMs);
  return ride;
}

export { DAY, HOUR };
