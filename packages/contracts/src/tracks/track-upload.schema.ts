import { z } from 'zod';

import { PageQuery, tolerantEnum, Uuid } from '../common.ts';

/** Лимит файла заезда (Q11): сервер отвечает `413 TRACK_TOO_LARGE`, приложение проверяет до отправки. */
export const TRACK_FILE_MAX_BYTES = 16 * 1024 * 1024;
/** Расширения для системного picker и pre-check приложения; сервер формат определяет по содержимому (R2). */
export const TRACK_FILE_EXTENSIONS = ['fit', 'gpx'] as const;

// справочники ответов: значения только добавляются в конец (старые сборки — `tolerantEnum`)
/** Формат исходника: файл загрузки или поток точек агрегатора (`stream` — только сервер, через HTTP не принимается). */
export const TRACK_FORMATS = ['fit', 'gpx', 'stream'] as const;
export const TRACK_SOURCES = ['upload', 'garmin', 'wahoo'] as const;
export const TRACK_UPLOAD_STATUSES = [
  'queued',
  'processing',
  'ready',
  'failed',
  'duplicate',
  'skipped',
] as const;
export const TRACK_FAILURE_CODES = [
  'unreadable',
  'no_track',
  'no_timestamps',
  'implausible',
  'too_many_points',
  'timeout',
  'storage',
] as const;
export const ACTIVITY_SPORTS = ['cycling', 'cycling_indoor', 'other', 'unknown'] as const;

export type TrackFormat = (typeof TRACK_FORMATS)[number];
export type TrackSource = (typeof TRACK_SOURCES)[number];
export type TrackUploadStatus = (typeof TRACK_UPLOAD_STATUSES)[number];
export type TrackFailureCode = (typeof TRACK_FAILURE_CODES)[number];
export type ActivitySport = (typeof ACTIVITY_SPORTS)[number];

/** Финальные статусы: приложение перестаёт опрашивать загрузку. */
export const TRACK_UPLOAD_FINAL_STATUSES: readonly TrackUploadStatus[] = [
  'ready',
  'failed',
  'duplicate',
  'skipped',
];

/**
 * `?name=` загрузки — исходное имя файла только для показа: ≤ 120 символов, без управляющих символов и разделителей
 * пути (`/`, `\`). Сервер не использует его ни для формата, ни для хранения.
 */
export const TrackUploadName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\p{Cc}/\\]+$/u);

/** `GET /v1/tracks/uploads` — свои загрузки, новые сверху, курсор `page-cursor`. */
export const TrackUploadQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TrackUploadQuery = z.infer<typeof TrackUploadQuery>;

/** Сводка активности загрузки — без координат, биометрии и служебных полей (v1). */
export const TrackActivitySummary = z.object({
  id: Uuid,
  sport: tolerantEnum(ACTIVITY_SPORTS),
  startedAt: z.iso.datetime(),
  elapsedSec: z.number().int().nonnegative(),
  distanceM: z.number().nonnegative(),
});

/**
 * Загрузка заезда (ответ приложения, `no-store`): `POST /v1/tracks/uploads` → `202` (новая) или `200` (тот же файл
 * уже загружен), `GET /v1/tracks/uploads/:id`. `failure` — только у `failed`/`skipped`.
 */
export const TrackUpload = z.object({
  id: Uuid,
  source: tolerantEnum(TRACK_SOURCES),
  format: tolerantEnum(TRACK_FORMATS),
  fileName: z.string().nullable(),
  status: tolerantEnum(TRACK_UPLOAD_STATUSES),
  failure: tolerantEnum(TRACK_FAILURE_CODES).nullable(),
  createdAt: z.iso.datetime(),
  activity: TrackActivitySummary.nullable(),
});
export type TrackUpload = z.infer<typeof TrackUpload>;

export const TrackUploadPage = z.object({
  items: z.array(TrackUpload),
  nextCursor: z.string().nullable(),
});
export type TrackUploadPage = z.infer<typeof TrackUploadPage>;
