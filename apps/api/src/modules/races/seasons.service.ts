import { Inject, Injectable } from '@nestjs/common';
import {
  addLocalDays,
  minskDayStartUtc,
  type PanelSeason,
  type PanelSeasonList,
  type SeasonInput,
  type UpdateSeasonRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit } from '../panel';
import type { SeasonDoc } from './races.collection';
import { seasonPhase } from './races.policy';
import { type InstantRange, RacesRepository } from './races.repository';
import { fieldError, staleVersion } from './schedule-errors';

type SeasonField = 'name' | 'startsOn' | 'endsOn';
const SEASON_FIELDS: readonly SeasonField[] = ['name', 'startsOn', 'endsOn'];

/** Границы-моменты сезона: 00:00 Минска дня начала и дня после конца. */
export function seasonRange(startsOn: string, endsOn: string): InstantRange {
  return {
    startsAt: minskDayStartUtc(startsOn),
    endsBefore: minskDayStartUtc(addLocalDays(endsOn, 1)),
  };
}

/**
 * Сезоны (ADR-0010, R1, R2): создание и изменение — в транзакции под `lockSchedule` (пересечение сезонов и «гонки
 * сезона остаются внутри» — условия по другим документам). Каждое изменение — запись журнала в той же транзакции.
 */
@Injectable()
export class SeasonsService {
  constructor(
    private readonly repository: RacesRepository,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<PanelSeasonList> {
    const [seasons, counts] = await Promise.all([
      this.repository.listSeasons(),
      this.repository.raceCounts(),
    ]);
    const now = this.clock.now();
    return { items: seasons.map((doc) => toPanelSeason(doc, counts.get(doc._id) ?? 0, now)) };
  }

  async create(actorUserId: string, input: SeasonInput): Promise<PanelSeason> {
    const doc = await this.transactions.run(async (tx) => {
      await this.repository.lockSchedule(tx);
      const now = this.clock.now();
      const range = this.checkDates(input.startsOn, input.endsOn, now);
      await this.checkOverlap(tx, input, range, null);
      const season: SeasonDoc = {
        _id: uuidv7(),
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        ...range,
        createdAt: now,
        updatedAt: now,
        version: 0,
      };
      await this.repository.insertSeason(tx, season);
      await this.audit.append(tx, {
        action: 'season.created',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'season', id: season._id, label: season.name },
      });
      return season;
    });
    return toPanelSeason(doc, 0, this.clock.now());
  }

  /**
   * Изменение: сверка `version` → завершённый — даты не меняются (имя — можно) → порядок дат → пересечение (кроме
   * себя) → гонки сезона остаются внутри → запись с условием на `version` → журнал `{ changedFields }`.
   */
  async update(actorUserId: string, id: string, input: UpdateSeasonRequest): Promise<PanelSeason> {
    const doc = await this.transactions.run(async (tx) => {
      await this.repository.lockSchedule(tx);
      const current = await this.repository.findSeason(id, tx);
      if (!current) throw domainError('NOT_FOUND', 404);
      if (current.version !== input.version) throw staleVersion();
      const now = this.clock.now();
      const next = {
        name: input.name ?? current.name,
        startsOn: input.startsOn ?? current.startsOn,
        endsOn: input.endsOn ?? current.endsOn,
      };
      const changed = SEASON_FIELDS.filter((field) => next[field] !== current[field]);
      if (changed.length === 0) return current;

      const datesChanged = changed.filter((field) => field !== 'name');
      let range: InstantRange = { startsAt: current.startsAt, endsBefore: current.endsBefore };
      if (datesChanged.length > 0) {
        if (seasonPhase(current, now) === 'finished') {
          throw fieldError(datesChanged[0] ?? 'startsOn', 'SEASON_FINISHED');
        }
        range = this.checkDates(next.startsOn, next.endsOn, now);
        await this.checkOverlap(tx, next, range, current._id);
        if ((await this.repository.racesOutside(current._id, range, tx)) > 0) {
          const shrankStart = range.startsAt > current.startsAt;
          throw fieldError(shrankStart ? 'startsOn' : 'endsOn', 'SEASON_EXCLUDES_RACES');
        }
      }
      const updated = await this.repository.updateSeason(tx, id, input.version, {
        ...next,
        ...range,
        updatedAt: now,
      });
      if (!updated) throw staleVersion();
      await this.audit.append(tx, {
        action: 'season.updated',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'season', id, label: updated.name },
        details: { changedFields: changed },
      });
      return updated;
    });
    return toPanelSeason(doc, await this.repository.countSeasonRaces(doc._id), this.clock.now());
  }

  /** Порядок дат и «целиком в прошлом». */
  private checkDates(startsOn: string, endsOn: string, now: Date): InstantRange {
    if (endsOn < startsOn) throw fieldError('endsOn', 'DATE_ORDER');
    const range = seasonRange(startsOn, endsOn);
    if (range.endsBefore <= now) throw fieldError('endsOn', 'SEASON_IN_PAST');
    return range;
  }

  /** Пересечение с другим сезоном: ошибка на поле, которое попало внутрь (оба или охват — на `startsOn`). */
  private async checkOverlap(
    tx: DbSession,
    dates: { startsOn: string; endsOn: string },
    range: InstantRange,
    exceptId: string | null,
  ): Promise<void> {
    const other = await this.repository.overlapping(range, exceptId, tx);
    if (!other) return;
    const inside = (date: string) => date >= other.startsOn && date <= other.endsOn;
    const path = !inside(dates.startsOn) && inside(dates.endsOn) ? 'endsOn' : 'startsOn';
    throw fieldError(path, 'SEASON_OVERLAP');
  }
}

export function toPanelSeason(doc: SeasonDoc, raceCount: number, now: Date): PanelSeason {
  return {
    id: doc._id,
    name: doc.name,
    startsOn: doc.startsOn,
    endsOn: doc.endsOn,
    phase: seasonPhase(doc, now),
    raceCount,
    version: doc.version,
  };
}
