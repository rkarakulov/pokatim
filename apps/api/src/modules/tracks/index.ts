export { TracksCoreModule, TracksModule, TracksWorkerModule } from './tracks.module';
export {
  TRACK_ACTIVITY_READY,
  TRACK_ACTIVITY_REMOVED,
  TrackActivityReady,
  TrackActivityRemoved,
  tracksOutboxRoutes,
  TRACK_UPLOAD_DELETED,
  TrackUploadDeleted,
} from './tracks.events';
/** Порт заездов для модуля `results`: группа дублей, свои активности и загрузки, исходник для worker. */
export {
  ACTIVITY_SOURCE,
  type ActivityRef,
  type ActivitySource,
  type UploadState,
} from './activity-source.port';
/** Порт приёма заездов от модуля `devices` (§5): поток агрегатора → тот же разбор, что ручная загрузка. */
export {
  type IngestProviderStreamInput,
  type IngestProviderStreamResult,
  type ProviderTrackSource,
  TRACK_INGEST,
  type TrackIngest,
  TrackIngestPreconditionError,
  TrackSourceDeletedError,
  TrackStorageFullError,
} from './track-ingest.port';
/** Порт стирания заездов удалённого аккаунта (модуль `account`). */
export { TrackErasure } from './track-erasure';
