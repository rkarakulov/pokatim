import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import { VerifiedProfileRepository } from './verified-profile.repository';
import type { VerifiedDemographics, VerifiedProfiles } from './verified-profiles.port';

/** Реализация порта `VERIFIED_PROFILES`: только пол и год, через репозиторий анкет. */
@Injectable()
export class VerifiedProfilesService implements VerifiedProfiles {
  constructor(private readonly repository: VerifiedProfileRepository) {}

  async demographicsOf(userId: string): Promise<VerifiedDemographics | null> {
    const doc = await this.repository.find(userId);
    return doc ? { gender: doc.gender, birthYear: doc.birthYear } : null;
  }

  lockForEntry(tx: DbSession, userId: string, now: Date): Promise<VerifiedDemographics | null> {
    return this.repository.lockForEntry(tx, userId, now);
  }
}
