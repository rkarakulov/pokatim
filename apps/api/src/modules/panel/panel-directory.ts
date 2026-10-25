import { Injectable } from '@nestjs/common';

import { DELETED_MEMBER } from './panel.policy';
import { PanelRepository } from './panel.repository';

/**
 * Порт имён сотрудников для доменных модулей панели (`races`, `calendar`): имя в панели (не e-mail) по id
 * пользователя. Модули не читают `panel_members` сами (`pokatim-db.md`). Документа члена команды нет —
 * «Удалённый участник»; снятый сотрудник сохраняет имя.
 */
@Injectable()
export class PanelDirectory {
  constructor(private readonly repository: PanelRepository) {}

  async displayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const names = await this.repository.displayNames(unique);
    return new Map(unique.map((userId) => [userId, names.get(userId) ?? DELETED_MEMBER]));
  }
}
