import { Injectable } from '@nestjs/common';

import { ProfileRepository } from './profile.repository';
import { VerifiedProfileRepository } from './verified-profile.repository';

/**
 * Порт стирания профиля удалённого аккаунта (модуль `account`, ADR-0015): документ `profiles` удаляется — имя пропадает
 * из таблиц («Участник», A3); анкета Verified (race-results-07) — тоже. Повторяемо: поздний `PATCH`/`PUT` может
 * воскресить документ — повторный проход удалит снова. `true` — удалён профиль (анкета стирается независимо).
 */
@Injectable()
export class ProfileErasure {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly verified: VerifiedProfileRepository,
  ) {}

  async erase(userId: string): Promise<boolean> {
    await this.verified.delete(userId);
    return this.repository.deleteProfile(userId);
  }
}
