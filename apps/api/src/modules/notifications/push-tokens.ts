import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import { NotificationsRepository } from './notifications.repository';

/**
 * Порт для модуля `account` (N11, ADR-0017): снять все push-токены пользователя в транзакции удаления аккаунта —
 * push перестают уходить сразу. Возвращает число снятых.
 */
@Injectable()
export class PushTokens {
  constructor(private readonly repository: NotificationsRepository) {}

  revokeAllOf(tx: DbSession, userId: string): Promise<number> {
    return this.repository.revokeAllTokens(tx, userId);
  }
}
