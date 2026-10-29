import { Injectable } from '@nestjs/common';

import { IdentityRepository } from './identity.repository';

/**
 * Порт `identity` для «Обзора» панели (admin-overview, модуль `overview`, только admin): регистрации за период
 * (подтверждённые, не удалённые) и
 * зависшие удаления аккаунтов — удалённые раньше `deletedBefore`, чья очистка так и не завершилась (повторный проход
 * штатно — через 15 мин, регламент resume — каждый час). Только чтение, без идентификаторов.
 */
@Injectable()
export class IdentityOverview {
  constructor(private readonly repository: IdentityRepository) {}

  createdSince(since: Date): Promise<number> {
    return this.repository.countCreatedSince(since);
  }

  stuckDeletions(deletedBefore: Date): Promise<number> {
    return this.repository.countPendingSweeps(deletedBefore);
  }
}
