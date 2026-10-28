import { Injectable } from '@nestjs/common';

import { ProfileRepository } from './profile.repository';
import type { PublicRiderRecord, RiderProfileDirectory } from './rider-profiles.port';

/** Реализация порта `RiderProfileDirectory`: читает `profiles` только через `ProfileRepository`. Имена не логирует. */
@Injectable()
export class RiderProfilesService implements RiderProfileDirectory {
  constructor(private readonly repository: ProfileRepository) {}

  async findPublic(publicId: string): Promise<PublicRiderRecord | null> {
    const doc = await this.repository.findPublic(publicId);
    if (!doc || typeof doc.publicName !== 'string') return null;
    return {
      userId: doc._id,
      publicName: doc.publicName,
      club: doc.club ?? null,
      avatarId: doc.avatarId ?? null,
    };
  }
}
