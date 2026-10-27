import { Injectable, Logger } from '@nestjs/common';

import { NotificationsRepository } from './notifications.repository';

export interface NotificationErasureResult {
  notifications: number;
  settings: number;
  tokens: number;
  tickets: number;
}

/**
 * Порт стирания для модуля `account` (N11, ADR-0015): уведомления, настройки, push-токены и их тикеты удалённого
 * аккаунта. Повторяемо (повторный проход очистки ничего не находит). Чужие уведомления о событиях с его участием не
 * меняются — имён в текстах нет (N12).
 */
@Injectable()
export class NotificationErasure {
  private readonly logger = new Logger(NotificationErasure.name);

  constructor(private readonly repository: NotificationsRepository) {}

  async erase(userId: string): Promise<NotificationErasureResult> {
    const result = await this.repository.eraseUser(userId);
    this.logger.log(
      `notifications.erased user=${userId} deleted=${result.notifications} settings=${result.settings} tokens=${result.tokens} tickets=${result.tickets}`,
    );
    return result;
  }
}
