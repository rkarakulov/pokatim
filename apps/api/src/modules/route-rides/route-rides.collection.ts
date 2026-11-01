import type { AttemptFailure, AttemptRejection, TrackSource } from '@pokatim/contracts';
import type { TrackMap } from '@pokatim/tracks/parse';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `route-rides` (route-rides-01): заезды райдера по маршрутам вне гонки — личные данные райдера.
 * Создаёт миграция `0032_route_rides`; единственный писатель — `RouteRidesRepository`. Не append-only: удаляются с
 * аккаунтом и сиротами (активность удалена) при следующем POST по маршруту (8.1 RC-1).
 */
export const ROUTE_RIDES_COLLECTIONS = {
  rides: 'route_rides',
  autoPlans: 'route_ride_auto_plans',
} as const;

export type RouteRideStatus = 'queued' | 'checking' | 'passed' | 'not_passed' | 'failed';
/** Происхождение заезда (route-rides-03): ручная проверка (POST) / автопроверка новой активности (worker). */
export type RouteRideOrigin = 'manual' | 'auto';

/** Снимок сводки активности на момент POST (неизменяема после разбора): окно сверки и строки истории. */
export interface RouteRideActivityDoc {
  startedAt: Date;
  endedAt: Date;
  source: TrackSource;
  elapsedSec: number;
  distanceM: number;
}

/** Сегмент между воротами — метрики движка без координат, датчиков и `noisePoints`. */
export interface RouteRideSegmentDoc {
  startedAt: Date;
  finishedAt: Date;
  elapsedSec: number;
  distanceM: number;
  offCorridorM: number;
  offCorridorShare: number;
  maxExcursionM: number;
  coverage: number;
}

/** Участок маршрута в заезде (route-rides-05, RC-11): метры по линии сверки, статус, время — без координат и причин. */
export interface RouteRideSectionDoc {
  fromM: number;
  toM: number;
  status: 'passed' | 'not_passed';
  /** только `passed` */
  elapsedSec: number | null;
}

/**
 * Участки заезда (route-rides-05): `version` — `ROUTE_SECTIONS_VERSION` разбиения (участки разных версий не
 * сравниваются); `failure` — отказ сверки участков (`timeout`, `unreadable`, `corridor_invalid`, сбой окружения —
 * `error`), тогда `items: []`; `items: []` без отказа — у маршрута участков нет. «Лучший» и дельты не храним —
 * считаются при чтении (`sectionsOf`).
 */
export interface RouteRideSectionsDoc {
  version: number;
  failure: AttemptFailure | null;
  items: RouteRideSectionDoc[];
}

/**
 * Заезд по маршруту — `(userId, routeId, activityId)` уникален (`activityId` — основная группы дублей на момент POST).
 * `checkRevision` — номер проверки: итог пишет только своя ревизия. Датчиков, флагов, диагностики и кандидатов нет
 * (минимизация).
 */
export interface RouteRideDoc {
  _id: string;
  userId: string;
  routeId: string;
  activityId: string;
  activity: RouteRideActivityDoc;
  /** происхождение; нет поля (документы до route-rides-03) — `manual`, бэкфилла нет */
  origin?: RouteRideOrigin;
  /** ширина коридора на момент создания (смена политики не переписывает старые вердикты молча, RC-15) */
  corridorWidthM: number;
  status: RouteRideStatus;
  checkRevision: number;
  checkAttempts: number;
  /** причины `not_passed` (первая — основная); иначе `[]` */
  reasons: AttemptRejection[];
  /** только `failed` */
  failure: AttemptFailure | null;
  segment: RouteRideSegmentDoc | null;
  touchedCorridor: boolean | null;
  engineVersion: number | null;
  /** позиции сегмента и схода на линии показа активности (`activity_tracks`), без координат */
  trackMap: TrackMap | null;
  /**
   * участки (route-rides-05); нет поля — заезд до 05 (бэкфилла нет), `null` — не считались (нет итога сверки,
   * провал основной сверки, автопроверка не `passed`, сброс `requeue`)
   */
  sections?: RouteRideSectionsDoc | null;
  createdAt: Date;
  updatedAt: Date;
  checkedAt: Date | null;
}

/** Итог проверки своей ревизией (`RouteRidesRepository.record`, автопроверка — `insertChecked`). */
export type RouteRideResult = Pick<
  RouteRideDoc,
  | 'status'
  | 'reasons'
  | 'failure'
  | 'segment'
  | 'touchedCorridor'
  | 'engineVersion'
  | 'trackMap'
  | 'checkedAt'
> &
  Required<Pick<RouteRideDoc, 'sections'>>;

/**
 * План автопроверки события (route-rides-03, ревью pass 3): `_id` — id события outbox `tracks.activity-group-created`,
 * маршруты (≤ 20) — фиксируются первой попыткой (`insertOne`, дубль `_id_` — план победителя); любой ретрай и повтор
 * события проверяет только их. `expiresAt` — уборка TTL (`0046_route_ride_auto_plans`); стирание — по `userId`.
 */
export interface RouteRideAutoPlanDoc {
  _id: string;
  userId: string;
  routeIds: string[];
  /** вставленных по плану автозаездов (route-rides-07: запись сериализует вставку с удалением заезда) */
  insertedRides?: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface RouteRidesCollections {
  rides: Collection<RouteRideDoc>;
  autoPlans: Collection<RouteRideAutoPlanDoc>;
}

export function routeRidesCollections(db: Db): RouteRidesCollections {
  return {
    rides: db.collection<RouteRideDoc>(ROUTE_RIDES_COLLECTIONS.rides),
    autoPlans: db.collection<RouteRideAutoPlanDoc>(ROUTE_RIDES_COLLECTIONS.autoPlans),
  };
}
