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
 * неизвестное — `null` без различия. `results` коллекции `tracks` не читает.
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
  /** Группа дублей активности (состояние сейчас); активности нет — `null`. */
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
  /** Исходник активности для worker; активности, файла или ключа нет — `null`. Сбой хранилища — исключение. */
  readSource(activityId: string): Promise<{ bytes: Uint8Array; format: TrackFormat } | null>;
}
