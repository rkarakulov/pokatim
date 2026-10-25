import { Inject, Injectable } from '@nestjs/common';
import type { AuditAction, PanelRole } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import type { AuditActor } from './panel.collection';
import { PanelRepository } from './panel.repository';

export interface AuditRecord {
  action: AuditAction;
  actor: AuditActor;
  targetUserId?: string | null;
  reason?: string | null;
  details?: { roleFrom?: PanelRole; roleTo?: PanelRole } | null;
}

/**
 * Журнал действий панели (append-only, `AGENTS.md` §4.10): единственный путь записи — `append` в **транзакции
 * действия** (откат действия — нет записи). Время — `CLOCK`. Экспортируется будущим модулям панели через
 * `modules/panel/index.ts`; без e-mail, IP и UA.
 */
@Injectable()
export class PanelAudit {
  constructor(
    private readonly repository: PanelRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async append(tx: DbSession, record: AuditRecord): Promise<void> {
    await this.repository.insertAudit(tx, {
      _id: uuidv7(),
      at: this.clock.now(),
      action: record.action,
      actor: record.actor,
      targetUserId: record.targetUserId ?? null,
      reason: record.reason ?? null,
      details: record.details ?? null,
    });
  }
}
