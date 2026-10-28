import { Inject, Injectable } from '@nestjs/common';
import type { RiderHistoryQuery, RiderRaceHistoryPage } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RACE_REGISTRY, type RaceRegistry } from '../races';
import { ResultsReadService } from './results-read.service';
import { ResultsRepository } from './results.repository';

/**
 * «Гонки» своего профиля (rider-profile, `GET /v1/profile/races`): активные заявки, новые гонки сверху. Результат —
 * та же `ResultsReadService.entryResult`, что «моё участие» и споры (ранжирование не дублируется); страница — в одной
 * snapshot-сессии. Гонка-черновик или неизвестная — строка пропускается.
 */
@Injectable()
export class ResultsHistoryService {
  constructor(
    private readonly repository: ResultsRepository,
    private readonly read: ResultsReadService,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string, query: RiderHistoryQuery): Promise<RiderRaceHistoryPage> {
    const after = query.cursor ? decodeCursor(query.cursor, z.iso.datetime()) : null;
    const now = this.clock.now();
    return this.repository.withSnapshot(async (session) => {
      const entries = await this.repository.entriesOfUserPage(
        userId,
        after ? { windowStartsAt: new Date(after.k), id: after.id } : null,
        query.limit + 1,
        session,
      );
      const page = entries.slice(0, query.limit);
      const items: RiderRaceHistoryPage['items'] = [];
      for (const entry of page) {
        const race = await this.races.get(entry.raceId, session);
        if (!race) continue;
        const result = await this.read.entryResult(race, entry, now, session);
        items.push({
          race: {
            id: race.id,
            title: race.title,
            windowStartsAt: race.windowStartsAt.toISOString(),
            windowEndsAt: race.windowEndsAt.toISOString(),
            status: race.status,
          },
          result: {
            status: result.status,
            place: result.place,
            tied: result.tied,
            elapsedSec: result.elapsedSec,
            unranked: result.unranked,
          },
          groupKey: entry.groupKey ?? 'overall',
          tier: entry.tier ?? 'verified',
        });
      }
      const last = page.at(-1);
      const nextCursor =
        entries.length > query.limit && last?.raceWindowStartsAt
          ? encodeCursor(last.raceWindowStartsAt.toISOString(), last._id)
          : null;
      return { items, nextCursor };
    });
  }
}
