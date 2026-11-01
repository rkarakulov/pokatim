import { Injectable } from '@nestjs/common';

import type { RaceEntryRespectTarget, ResultsForSocial } from './results-for-social.port';
import { ResultsReadService } from './results-read.service';

/** Реализация порта `ResultsForSocial` (P4): видимость строки — `ResultsReadService.publicRow`, как у публичной таблицы. */
@Injectable()
export class ResultsForSocialService implements ResultsForSocial {
  constructor(private readonly read: ResultsReadService) {}

  async respectTarget(entryId: string): Promise<RaceEntryRespectTarget | null> {
    const row = await this.read.publicRow(entryId);
    return row ? { entryId: row.entryId, raceId: row.raceId, ownerUserId: row.userId } : null;
  }
}
