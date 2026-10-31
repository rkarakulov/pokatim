import type {
  ActivitySport,
  TrackFailureCode,
  TrackFormat,
  TrackSource,
  TrackUploadStatus,
} from '@pokatim/contracts';
import type { Bounds } from '@pokatim/tracks';

import type { DbSession } from '../../db';

/**
 * Порт `tracks` для модуля `results` (через `modules/tracks/index.ts`, race-results-03): заезды пользователя как
 * источник попыток гонки. Владение — по `userId` вызывающего сервера (из access, не из запроса клиента); чужое и
 * неизвестное — `null` без различия; исключение — `liveActivityIds` (только набор живых id, route-rides-04). `results`
 * коллекции `tracks` не читает.
 */
export const ACTIVITY_SOURCE = Symbol('ACTIVITY_SOURCE');

/** Активность для попытки: без координат и биометрии, кроме рамки линии (предфильтр). */
export interface ActivityRef {
  id: string;
  userId: string;
  uploadId: string;
  /** время приёма файла сервером (`track_uploads.createdAt`) — граница A5 */
  uploadCreatedAt: Date;
  isPrimary: boolean;
  /** `duplicateOf ?? id` */
  primaryId: string;
  sport: ActivitySport;
  source: TrackSource;
  startedAt: Date;
  endedAt: Date;
  elapsedSec: number;
  distanceM: number;
  /** рамка линии показа; без линии — точка старта */
  bounds: Bounds;
}

export interface UploadState {
  status: TrackUploadStatus;
  failure: TrackFailureCode | null;
  createdAt: Date;
  /** активность загрузки (основная или дубль); `null` — ещё нет или не будет */
  activity: ActivityRef | null;
}

export interface ActivitySource {
  /**
   * Группа дублей активности (состояние сейчас): `members` — в порядке приоритета основной (первый — основная);
   * активности нет — `null`.
   */
  group(
    activityId: string,
    tx?: DbSession,
  ): Promise<{ userId: string; members: ActivityRef[] } | null>;
  /** Своя активность; чужая и неизвестная — `null`. */
  activity(userId: string, activityId: string, tx?: DbSession): Promise<ActivityRef | null>;
  /** Своя загрузка; чужая и неизвестная — `null`. */
  uploadState(userId: string, uploadId: string, tx?: DbSession): Promise<UploadState | null>;
  /** Статусы своих загрузок (неизвестные — нет в карте). */
  uploadStates(
    userId: string,
    uploadIds: readonly string[],
  ): Promise<Map<string, { status: TrackUploadStatus; failure: TrackFailureCode | null }>>;
  /** Свои основные активности, пересекающие `[from, to)`, новые сверху. */
  listInRange(userId: string, from: Date, to: Date, limit: number): Promise<ActivityRef[]>;
  /**
   * Загрузки пользователей в `queued|processing`, принятые сервером в `[from, before)` (race-results-05: строка
   * чек-листа публикации «необработанные треки»). `userIds` — участники гонки (≤ числа активных заявок).
   */
  countUnprocessed(
    userIds: readonly string[],
    from: Date,
    before: Date,
    tx?: DbSession,
  ): Promise<number>;
  /**
   * Линия показа своей активности (`activity_tracks`, [lon, lat], ≤ 1000 точек) — карта трека участника и разметка
   * схода (maps-02); чужая, неизвестная или без линии — `null`.
   */
  trackLine(userId: string, activityId: string): Promise<[number, number][] | null>;
  /**
   * Какие из активностей пользователя живы сейчас и основная их группы (route-rides-01, RC-2): ≤ 200 id одним
   * запросом; чужие, удалённые и неизвестные — нет в карте; пустой вход — пустая карта без запроса.
   */
  liveActivities(
    userId: string,
    ids: readonly string[],
  ): Promise<Map<string, { primaryId: string }>>;
  /**
   * Какие из активностей (**любых** пользователей) живы сейчас (route-rides-04, RC-5: таблица «Другие» маршрута).
   * Единственный метод порта без `userId`: наружу — только подмножество входных id (ни `userId`, ни сводок);
   * ≤ 1000 id за вызов (больше — `Error`), пустой вход — пустое множество без запроса.
   */
  liveActivityIds(ids: readonly string[]): Promise<Set<string>>;
  /** Исходник активности для worker; активности, файла или ключа нет — `null`. Сбой хранилища — исключение. */
  readSource(activityId: string): Promise<{ bytes: Uint8Array; format: TrackFormat } | null>;
}
