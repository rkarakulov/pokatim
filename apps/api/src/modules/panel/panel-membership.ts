import { Injectable } from '@nestjs/common';

import { PanelRepository } from './panel.repository';

/**
 * Порт членства в команде панели для удаления аккаунта (модуль `account`, A11): пока у райдера активная роль,
 * удаление запрещено. Одно чтение по `_id`; `panel_members` читает только `panel`.
 */
@Injectable()
export class PanelMembership {
  constructor(private readonly repository: PanelRepository) {}

  async hasActiveRole(userId: string): Promise<boolean> {
    return (await this.repository.findActiveMember(userId)) !== undefined;
  }
}
