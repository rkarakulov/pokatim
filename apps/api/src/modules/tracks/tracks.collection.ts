import type {
  ActivitySport,
  TrackFailureCode,
  TrackFormat,
  TrackSource,
  TrackUploadStatus,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `tracks` (ADR-0011). Создаёт миграция `0010_tracks`; единственный писатель — `TracksRepository`.
 * Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным `null`. Биометрия не хранится (R9): только флаги.
 */
export const TRACKS_COLLECTIONS = {
  uploads: 'track_uploads',
  activities: 'activities',
  tracks: 'activity_tracks',
  meta: 'activity_meta',
  sourceRefs: 'track_source_refs',
} as const;

/** Через что пришёл исходник провайдера (агрегатор); у ручной загрузки — `null`. */
export type TrackVia = 'open_wearables';

/**
 * Загрузка: исходник (файл или поток агрегатора) и статус обработки. Уникальны `(userId, sha256)` (тот же файл) и
 * `(source, sourceRef)` (тот же объект провайдера). `storageKey` — `null`, когда исходник удалён уборкой.
 */
export interface TrackUploadDoc {
  _id: string;
  userId: string;
  source: TrackSource;
  via: TrackVia | null;
  sourceRef: string | null;
  format: TrackFormat;
  fileName: string | null;
  sizeBytes: number;
  sha256: string;
  storageKey: string | null;
  status: TrackUploadStatus;
  failure: TrackFailureCode | null;
  attempts: number;
  activityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Активность (заезд) — сводка из исходника, неизменяема после `ready`. `duplicateOf` — id основной активности группы
 * дублей (R7) или `null` у основной/одиночной.
 */
export interface ActivityDoc {
  _id: string;
  userId: string;
  uploadId: string;
  source: TrackSource;
  sport: ActivitySport;
  startedAt: Date;
  endedAt: Date;
  elapsedSec: number;
  movingSec: number;
  distanceM: number;
  elevationGainM: number | null;
  hasHeartRate: boolean;
  hasPower: boolean;
  startPoint: { type: 'Point'; coordinates: [number, number] };
  duplicateOf: string | null;
  createdAt: Date;
}

/** Упрощённая линия активности (`_id` = id активности): отдельно — большой документ не читается в списках. */
export interface ActivityTrackDoc {
  _id: string;
  userId: string;
  line: { type: 'LineString'; coordinates: [number, number][] };
  sourcePointCount: number;
}

/**
 * Документ-замок активностей пользователя (`_id` = userId): транзакция, вставляющая или удаляющая активность, первой
 * операцией пишет `version` (`lockUserActivities`) — «в группе одна основная» — условие по другим документам.
 */
export interface ActivityMetaDoc {
  _id: string;
  version: number;
}

/**
 * Устойчивый маркер объекта источника (`_id` = `<source>:<sourceRef>`): `live` — заезд принят, `deleted` — пользователь
 * удалил загрузку (повтор импорта её не вернёт). Приём и удаление пишут этот документ в своих транзакциях — гонка
 * «приём ↔ удаление» конфликтует на нём (R7-подобный замок без отдельного meta).
 */
export interface TrackSourceRefDoc {
  _id: string;
  userId: string;
  state: 'live' | 'deleted';
  updatedAt: Date;
}

export interface TracksCollections {
  uploads: Collection<TrackUploadDoc>;
  activities: Collection<ActivityDoc>;
  tracks: Collection<ActivityTrackDoc>;
  meta: Collection<ActivityMetaDoc>;
  sourceRefs: Collection<TrackSourceRefDoc>;
}

export function tracksCollections(db: Db): TracksCollections {
  return {
    uploads: db.collection<TrackUploadDoc>(TRACKS_COLLECTIONS.uploads),
    activities: db.collection<ActivityDoc>(TRACKS_COLLECTIONS.activities),
    tracks: db.collection<ActivityTrackDoc>(TRACKS_COLLECTIONS.tracks),
    meta: db.collection<ActivityMetaDoc>(TRACKS_COLLECTIONS.meta),
    sourceRefs: db.collection<TrackSourceRefDoc>(TRACKS_COLLECTIONS.sourceRefs),
  };
}
