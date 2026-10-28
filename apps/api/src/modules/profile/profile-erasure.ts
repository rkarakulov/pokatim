import { Injectable } from '@nestjs/common';

import { ProfileAvatarRepository } from './profile-avatar.repository';
import { ProfileRepository } from './profile.repository';
import { VerifiedProfileRepository } from './verified-profile.repository';

/**
 * Порт стирания профиля удалённого аккаунта (модуль `account`, ADR-0015): документ `profiles` удаляется — имя пропадает
 * из таблиц («Участник», A3); анкета Verified (race-results-07) — тоже. Повторяемо: поздний `PATCH`/`PUT` может
 * воскресить документ — повторный проход удалит снова. `true` — удалён профиль (анкета стирается независимо).
 * rider-profile: до профиля — все аватары пользователя (`ProfileAvatarRepository.deleteAllOf`): старые id отдают 404.
 */
@Injectable()
export class ProfileErasure {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly verified: VerifiedProfileRepository,
    private readonly avatars: ProfileAvatarRepository,
  ) {}

  async erase(userId: string): Promise<boolean> {
    await this.verified.delete(userId);
    await this.avatars.deleteAllOf(userId);
    return this.repository.deleteProfile(userId);
  }
}
