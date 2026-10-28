import { Inject, Injectable } from '@nestjs/common';
import { sliceLine } from '@pokatim/route-view';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { ROUTE_GEOMETRY, type RouteGeometry } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type { RaceAttemptDoc } from './results.collection';
import { storyCardEligible } from './results.policy';
import type {
  ResultsForSharing,
  StoryCardFacts,
  StoryCardLine,
  StoryCardResultStatus,
} from './results-for-sharing.port';
import { ResultsReadService } from './results-read.service';
import { ResultsRepository } from './results.repository';

const attemptFacts = (attempt: RaceAttemptDoc | undefined): StoryCardFacts['attempt'] =>
  attempt
    ? {
        id: attempt._id,
        checkRevision: attempt.checkRevision,
        segment: attempt.trackMap?.segment ?? null,
        linePoints: attempt.trackMap?.linePoints ?? null,
      }
    : null;

/**
 * Реализация порта `ResultsForSharing` (story-cards): статус, время и место — тот же код, что «моё участие»
 * (`ResultsReadService.entryResult`), без второго расчёта мест; предикат карточки — `storyCardEligible` (как
 * `actions.canShareStory`). Попытка результата: опубликован протокол — строка текущей ревизии (пересчёт мог сменить
 * лучшую), иначе — `best` заявки.
 */
@Injectable()
export class ResultsForSharingService implements ResultsForSharing {
  constructor(
    private readonly repository: ResultsRepository,
    private readonly read: ResultsReadService,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(ROUTE_GEOMETRY) private readonly routes: RouteGeometry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async storyCardFacts(userId: string, raceId: string): Promise<StoryCardFacts | null> {
    const race = await this.read.race(raceId);
    const now = this.clock.now();
    return this.repository.withSnapshot(async (session) => {
      const entry = await this.repository.findEntry(raceId, userId, session);
      if (!entry) return null;
      const result = await this.read.entryResult(race, entry, now, session);
      if (!storyCardEligible(entry, result) || result.elapsedSec === null) return null;
      let attemptId = entry.best?.attemptId ?? null;
      if (race.protocolPublishedAt !== null) {
        const revision = (await this.repository.currentRevision(race.id, session)) ?? 1;
        const row = await this.repository.protocolRow(race.id, revision, entry._id, session);
        if (row) attemptId = row.attemptId;
      }
      const attempt = attemptId ? await this.repository.findAttempt(attemptId, session) : undefined;
      return {
        entryId: entry._id,
        race: {
          title: race.title,
          windowStartsAt: race.windowStartsAt,
          windowEndsAt: race.windowEndsAt,
          routeId: race.corridor?.routeId ?? null,
        },
        status: result.status as StoryCardResultStatus,
        elapsedSec: result.elapsedSec,
        place: result.place,
        tied: result.tied,
        group: entry.groupKey ?? 'overall',
        attempt: attempt?.entryId === entry._id ? attemptFacts(attempt) : null,
      };
    });
  }

  async storyCardLine(userId: string, facts: StoryCardFacts): Promise<StoryCardLine | null> {
    const own = await this.attemptLine(userId, facts);
    if (own) return { kind: 'attempt', line: own };
    if (!facts.race.routeId) return null;
    const route = await this.routes.displayGeometry(facts.race.routeId);
    return route ? { kind: 'route', line: route.line } : null;
  }

  /** Отрезок своей засчитанной попытки между воротами; разметки нет или устарела — `null`. */
  private async attemptLine(userId: string, facts: StoryCardFacts) {
    if (!facts.attempt) return null;
    const attempt = await this.repository.findAttempt(facts.attempt.id);
    const segment = attempt?.trackMap?.segment ?? null;
    if (!attempt || attempt.userId !== userId || attempt.status !== 'counted' || !segment) {
      return null;
    }
    const line = await this.activities.trackLine(userId, attempt.activityId);
    if (!line || line.length !== attempt.trackMap!.linePoints) return null;
    return sliceLine(line, segment[0], segment[1]);
  }
}
