import type { TrackStreamV1 } from '@pokatim/tracks';

/** Источник заезда от провайдера через агрегатор. */
export type ProviderTrackSource = 'garmin' | 'wahoo';

export interface IngestProviderStreamInput {
  userId: string;
  source: ProviderTrackSource;
  via: 'open_wearables';
  /** Непрозрачный id объекта у источника (тренировка агрегатора): `(source, sourceRef)` уникален. */
  sourceRef: string;
  stream: TrackStreamV1;
}

export interface IngestProviderStreamResult {
  uploadId: string;
  /** `false` — загрузка с этим `(source, sourceRef)` или теми же байтами уже есть (повтор безопасен). */
  created: boolean;
}

/**
 * Порт приёма заезда от модуля `devices` (§5): поток точек агрегатора сохраняется исходником (`pokatim.stream.v1`,
 * gzip JSON) и проходит тот же `track-processing`, что ручная загрузка. Хранилище переполнено —
 * `TrackStorageFullError` (вызывающий откладывает повтор).
 */
export interface TrackIngest {
  ingestProviderStream(input: IngestProviderStreamInput): Promise<IngestProviderStreamResult>;
  /** Удалить загрузки источника пользователя (отключение с галочкой «Удалить заезды»); число удалённых. */
  deleteSourceUploads(userId: string, source: ProviderTrackSource): Promise<number>;
}

export const TRACK_INGEST = Symbol('TRACK_INGEST');

/** Хранилище исходников переполнено (квота или свободное место): загрузка не принята. */
export class TrackStorageFullError extends Error {
  constructor() {
    super('track storage is full');
    this.name = 'TrackStorageFullError';
  }
}
