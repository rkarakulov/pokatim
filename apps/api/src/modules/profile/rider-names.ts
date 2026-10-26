import { Injectable } from '@nestjs/common';

import { ProfileRepository } from './profile.repository';
import type { RiderNameDirectory } from './rider-names.port';

/** Реализация порта `RiderNameDirectory`: читает `profiles` только через `ProfileRepository`. Имена не логирует. */
@Injectable()
export class RiderNamesService implements RiderNameDirectory {
  constructor(private readonly repository: ProfileRepository) {}

  async publicNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    return this.repository.findPublicNames(unique);
  }
}
