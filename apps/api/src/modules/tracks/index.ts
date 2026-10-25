export { TracksCoreModule, TracksModule, TracksWorkerModule } from './tracks.module';
export { tracksOutboxRoutes, TRACK_UPLOAD_DELETED, TrackUploadDeleted } from './tracks.events';
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
