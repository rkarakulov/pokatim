import { Injectable } from '@nestjs/common';

import { ProfileRepository } from './profile.repository';

/**
 * Порт стирания профиля удалённого аккаунта (модуль `account`, ADR-0015): документ `profiles` удаляется — имя пропадает
 * из таблиц («Участник», A3). Повторяемо: поздний `PATCH` может воскресить документ — повторный проход удалит снова.
 */
@Injectable()
export class ProfileErasure {
  constructor(private readonly repository: ProfileRepository) {}

  erase(userId: string): Promise<boolean> {
    return this.repository.deleteProfile(userId);
  }
}
