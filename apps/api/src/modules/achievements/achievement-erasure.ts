import { Injectable } from '@nestjs/common';

import { AchievementsRepository } from './achievements.repository';

/**
 * Порт стирания достижений удалённого аккаунта (модуль `account`, ADR-0015): выдачи (обе коллекции) и маркер первой сверки.
 * Повторяемо (повтор — нули).
 */
@Injectable()
export class AchievementErasure {
  constructor(private readonly repository: AchievementsRepository) {}

  erase(userId: string): Promise<{ grants: number; seasonGrants: number; syncs: number }> {
    return this.repository.deleteAllOf(userId);
  }
}
