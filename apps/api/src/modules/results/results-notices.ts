import { Injectable } from '@nestjs/common';

import type { AttemptNotice, ResultsNotices } from './results-notices.port';
import { ResultsRepository } from './results.repository';

/** Реализация порта `ResultsNotices` (notifications): проекции `ResultsRepository`. */
@Injectable()
export class ResultsNoticesService implements ResultsNotices {
  constructor(private readonly repository: ResultsRepository) {}

  async attempt(attemptId: string): Promise<AttemptNotice | null> {
    const doc = await this.repository.attemptForNotice(attemptId);
    if (!doc) return null;
    return { userId: doc.userId, raceId: doc.raceId, activityStartedAt: doc.activity.startedAt };
  }

  protocolAudience(raceId: string): Promise<string[]> {
    return this.repository.activeEntryUserIds(raceId);
  }

  revisionAudience(raceId: string, revision: number): Promise<string[]> {
    return this.repository.protocolRowUserIds(raceId, revision);
  }

  entryUser(entryId: string): Promise<string | null> {
    return this.repository.entryUserId(entryId);
  }
}
