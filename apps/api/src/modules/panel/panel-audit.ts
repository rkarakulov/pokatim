import { Inject, Injectable } from '@nestjs/common';
import type { AuditAction, AuditEntry, AuditPage, AuditQuery, PanelRole } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import type { AuditActor } from './panel.collection';
import { DELETED_MEMBER } from './panel.policy';
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

/**
 * Чтение журнала для экрана «Журнал действий» (`audit.read`): новые сверху, курсор — id последней записи страницы;
 * имена актёра и цели — из `panel_members` (e-mail в журнале не показывается).
 */
@Injectable()
export class PanelAuditReader {
  constructor(private readonly repository: PanelRepository) {}

  async list(query: AuditQuery): Promise<AuditPage> {
    const docs = await this.repository.listAudit(
      {
        before: query.cursor,
        action: query.action,
        actorUserId: query.actorUserId,
        targetUserId: query.targetUserId,
      },
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const ids = new Set<string>();
    for (const doc of page) {
      if (doc.actor.kind === 'user') ids.add(doc.actor.userId);
      if (doc.targetUserId) ids.add(doc.targetUserId);
    }
    const names = await this.repository.displayNames([...ids]);
    const nameOf = (userId: string) => names.get(userId) ?? DELETED_MEMBER;
    return {
      items: page.map((doc): AuditEntry => ({
        id: doc._id,
        at: doc.at.toISOString(),
        action: doc.action,
        actor:
          doc.actor.kind === 'user'
            ? { kind: 'user', userId: doc.actor.userId, displayName: nameOf(doc.actor.userId) }
            : { kind: 'cli' },
        target: doc.targetUserId
          ? { userId: doc.targetUserId, displayName: nameOf(doc.targetUserId) }
          : null,
        reason: doc.reason,
        details: doc.details,
      })),
      nextCursor: docs.length > query.limit ? (page.at(-1)?._id ?? null) : null,
    };
  }
}
