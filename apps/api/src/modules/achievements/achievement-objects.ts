import { Inject, Injectable } from '@nestjs/common';

import { RIDER_RESULTS, type RiderResults } from '../results';
import { RIDER_RIDES, type RiderRides } from '../rides';
import { RIDER_ROUTE_RIDES, type RiderRouteRides } from '../route-rides';
import type { AchievementObjectRef } from './achievements.policy';

/** Ключ объекта в карте названий: `<вид>:<id>`. */
export const objectKey = (ref: AchievementObjectRef) => `${ref.kind}:${ref.id}`;

/**
 * Объекты ручных выдач несезонных достижений (achievements-panel, 5.C) — порты владельцев: гонка — `racesOf`
 * (опубликована или отменена, дата — `windowStartsAt`), маршрут — `routeTitles` (виден райдеру сейчас, дата — момент
 * решения, RC-2), райд — `ridesOf` (опубликован, старт прошёл, дата — `startsAt`). Одна точка названий ручных выдач для
 * ответов райдера, карточки, уведомлений и панели. Сезоны — порт `standings` (не здесь: модуль чтения его не получает).
 * Только чтение.
 */
@Injectable()
export class AchievementObjects {
  constructor(
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    @Inject(RIDER_ROUTE_RIDES) private readonly routeRides: RiderRouteRides,
    @Inject(RIDER_RIDES) private readonly rides: RiderRides,
  ) {}

  /** Годный объект ручной выдачи: название и дата факта; не найден среди объектов своего вида — `null`. */
  async resolve(
    userId: string,
    ref: AchievementObjectRef,
    now: Date,
  ): Promise<{ title: string; factAt: Date } | null> {
    switch (ref.kind) {
      case 'race': {
        const race = (await this.results.racesOf([ref.id])).get(ref.id);
        return race ? { title: race.title, factAt: race.windowStartsAt } : null;
      }
      case 'route': {
        const title = (await this.routeRides.routeTitles(userId, [ref.id])).get(ref.id);
        return title === undefined ? null : { title, factAt: now };
      }
      case 'ride': {
        const ride = (await this.rides.ridesOf([ref.id])).get(ref.id);
        return ride ? { title: ride.title, factAt: ride.startsAt } : null;
      }
    }
  }

  /** Текущие названия объектов (одна пачка на вид); недоступный объект — нет в карте. */
  async titles(
    userId: string,
    refs: readonly AchievementObjectRef[],
  ): Promise<Map<string, string>> {
    const ids = (kind: AchievementObjectRef['kind']) => [
      ...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id)),
    ];
    const [raceIds, routeIds, rideIds] = [ids('race'), ids('route'), ids('ride')];
    const [races, routes, rides] = await Promise.all([
      raceIds.length > 0 ? this.results.racesOf(raceIds) : new Map(),
      routeIds.length > 0 ? this.routeRides.routeTitles(userId, routeIds) : new Map(),
      rideIds.length > 0 ? this.rides.ridesOf(rideIds) : new Map(),
    ]);
    const result = new Map<string, string>();
    for (const [id, race] of races) result.set(objectKey({ kind: 'race', id }), race.title);
    for (const [id, title] of routes) result.set(objectKey({ kind: 'route', id }), title);
    for (const [id, ride] of rides) result.set(objectKey({ kind: 'ride', id }), ride.title);
    return result;
  }
}
