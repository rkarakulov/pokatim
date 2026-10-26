import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResetRiderNameRequest, RiderNameResetResult } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit } from '../panel';
import { ProfileRepository } from './profile.repository';

/** Подпись райдера в журнале действий (D3): снимок без ПДн — служебная подпись и короткий id, не имя. */
export const riderSubjectLabel = (userId: string) => `Участник ·${userId.slice(-6)}`;

/**
 * Сброс публичного имени райдера модератором (profile-02, `profiles.moderate`). Одна транзакция (D5): **первой** —
 * условная запись профиля (имя есть), затем `PanelAudit.append`; откат — ни сброса, ни записи. Имени уже нет —
 * `{ reset: false }` без журнала (D2), профиля нет — 404. Согласие и журнал согласий не трогаются. Ни сброшенное имя,
 * ни причина, ни `userId` райдера в лог не попадают (D14).
 */
@Injectable()
export class ProfileModerationService {
  private readonly logger = new Logger(ProfileModerationService.name);

  constructor(
    private readonly repository: ProfileRepository,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async resetName(
    actorUserId: string,
    userId: string,
    body: ResetRiderNameRequest,
  ): Promise<RiderNameResetResult> {
    const now = this.clock.now();
    const reset = await this.transactions.run(async (tx) => {
      const outcome = await this.repository.resetPublicName(tx, userId, now);
      if (outcome === 'not_found') throw domainError('NOT_FOUND', 404);
      if (outcome === 'empty') return false;
      await this.audit.append(tx, {
        action: 'profile.name_reset',
        actor: { kind: 'user', userId: actorUserId },
        // targetUserId не заполняется: читатель журнала ищет его среди членов команды (D3)
        subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
        reason: body.reason,
        details: null,
      });
      return true;
    });
    this.logger.log(`profile name reset by ${actorUserId} reset=${reset}`);
    return { reset };
  }
}
