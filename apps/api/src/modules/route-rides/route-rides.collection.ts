import type { AttemptFailure, AttemptRejection, TrackSource } from '@pokatim/contracts';
import type { TrackMap } from '@pokatim/tracks/parse';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `route-rides` (route-rides-01): заезды райдера по маршрутам вне гонки — личные данные райдера.
 * Создаёт миграция `0032_route_rides`; единственный писатель — `RouteRidesRepository`. Не append-only: удаляются с
 * аккаунтом и сиротами (активность удалена) при следующем POST по маршруту (8.1 RC-1).
 */
export const ROUTE_RIDES_COLLECTIONS = { rides: 'route_rides' } as const;

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
  createdAt: Date;
  updatedAt: Date;
  checkedAt: Date | null;
}

export interface RouteRidesCollections {
  rides: Collection<RouteRideDoc>;
}

export function routeRidesCollections(db: Db): RouteRidesCollections {
  return { rides: db.collection<RouteRideDoc>(ROUTE_RIDES_COLLECTIONS.rides) };
}
