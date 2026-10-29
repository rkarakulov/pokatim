import { Injectable } from '@nestjs/common';
import type { RacePhase } from '@pokatim/contracts';

import type { DbSession } from '../../db';
import type { PanelPrincipal } from '../panel';
import type { RaceForResults, RaceRegistry } from './race-registry.port';
import type { RaceDoc } from './races.collection';
import { RACE_POLICY, racePhase, raceVisible } from './races.policy';
import { RacesRepository } from './races.repository';

/** Гонка порта из документа (общий маппинг `RaceRegistry` и `RacesOverview`). */
export const toRace = (doc: RaceDoc): RaceForResults => ({
  id: doc._id,
  ownerUserId: doc.ownerUserId,
  status: doc.status,
  title: doc.title,
  windowStartsAt: doc.windowStartsAt,
  windowEndsAt: doc.windowEndsAt,
  closesAt: new Date(doc.windowEndsAt.getTime() + RACE_POLICY.windowEndGraceMs),
  protocolPlannedAt: doc.protocolPlannedAt,
  corridor: doc.corridor ?? null,
  lockedAt: doc.lockedAt ?? null,
  groupScheme: doc.groupScheme ?? (doc.lockedAt ? 'overall' : null),
  protocolPublishedAt: doc.protocolPublishedAt ?? null,
  disputeFilingClosedAt: doc.disputeFilingClosedAt ?? null,
});

/** Реализация порта `RaceRegistry`: читает и пишет `races` только через `RacesRepository`. */
@Injectable()
export class RaceRegistryService implements RaceRegistry {
  constructor(private readonly repository: RacesRepository) {}

  async admitEntry(tx: DbSession, raceId: string, now: Date): Promise<RaceForResults | null> {
    const doc = await this.repository.admitEntry(tx, raceId, now);
    return doc ? toRace(doc) : null;
  }

  async lockResults(tx: DbSession, raceId: string): Promise<RaceForResults | null> {
    const doc = await this.repository.lockResults(tx, raceId);
    return doc ? toRace(doc) : null;
  }

  markProtocolPublished(tx: DbSession, raceId: string, at: Date): Promise<boolean> {
    return this.repository.markProtocolPublished(tx, raceId, at);
  }

  async get(raceId: string, tx?: DbSession): Promise<RaceForResults | null> {
    const doc = await this.repository.findRace(raceId, tx);
    if (!doc || doc.status === 'draft') return null;
    return toRace(doc);
  }

  async getMany(raceIds: readonly string[]): Promise<Map<string, RaceForResults>> {
    const docs = await this.repository.findRaces(raceIds);
    return new Map(
      docs.filter((doc) => doc.status !== 'draft').map((doc) => [doc._id, toRace(doc)] as const),
    );
  }

  async findForPanel(principal: PanelPrincipal, raceId: string): Promise<RaceForResults | null> {
    const doc = await this.repository.findRace(raceId);
    if (!doc || !raceVisible(principal, doc)) return null;
    return toRace(doc);
  }

  phase(race: RaceForResults, now: Date): RacePhase {
    return racePhase(race, now);
  }
}
