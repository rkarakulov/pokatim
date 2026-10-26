import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import type { RaceCancelGate } from '../races';
import type { ResultDisputeGate } from '../results';
import { DisputesRepository } from './disputes.repository';

/**
 * Гейты споров для `results` (D-39, чек-лист публикации) и `races` (D-19) — RC-1. Зависят только от
 * `DisputesRepository`; регистрирует `@Global DisputesCoreModule`.
 */
@Injectable()
export class DisputeGates implements ResultDisputeGate, RaceCancelGate {
  constructor(private readonly repository: DisputesRepository) {}

  openAgainst(entryId: string, session?: DbSession): Promise<number> {
    return this.repository.countOpenAgainst(entryId, session);
  }

  openInRace(raceId: string, session?: DbSession): Promise<number> {
    return this.repository.countOpenInRace(raceId, session);
  }

  openDisputes(raceId: string, session?: DbSession): Promise<number> {
    return this.repository.countOpenInRace(raceId, session);
  }

  openDisputesByRace(raceIds: readonly string[]): Promise<Map<string, number>> {
    return this.repository.countOpenByRace(raceIds);
  }
}
