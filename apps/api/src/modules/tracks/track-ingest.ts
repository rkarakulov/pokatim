import { Injectable } from '@nestjs/common';
import { encodeTrackStream } from '@pokatim/tracks/parse';

import type {
  IngestProviderStreamInput,
  IngestProviderStreamResult,
  ProviderTrackSource,
  TrackIngest,
} from './track-ingest.port';
import { TrackSourcesService } from './track-sources.service';
import { TrackUploadsService } from './track-uploads.service';

/**
 * Реализация порта `TrackIngest` (§5): поток точек агрегатора → исходник `pokatim.stream.v1` (gzip JSON) → тот же
 * приём и разбор, что у ручной загрузки. Повтор того же `(source, sourceRef)` — прежняя загрузка (`created: false`).
 */
@Injectable()
export class TrackIngestService implements TrackIngest {
  constructor(
    private readonly sources: TrackSourcesService,
    private readonly uploads: TrackUploadsService,
  ) {}

  async ingestProviderStream(
    input: IngestProviderStreamInput,
  ): Promise<IngestProviderStreamResult> {
    const { upload, created } = await this.sources.store({
      userId: input.userId,
      source: input.source,
      via: input.via,
      sourceRef: input.sourceRef,
      format: 'stream',
      fileName: null,
      bytes: encodeTrackStream(input.stream),
    });
    return { uploadId: upload._id, created };
  }

  deleteSourceUploads(userId: string, source: ProviderTrackSource): Promise<number> {
    return this.uploads.deleteSource(userId, source);
  }
}
