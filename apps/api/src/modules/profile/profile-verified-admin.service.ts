import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PanelVerifiedDemographics,
  UpdateVerifiedDemographicsRequest,
  VerifiedDemographicsResult,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit } from '../panel';
import { riderSubjectLabel } from './profile-moderation.service';
import type { Demographics } from './verified-profile.repository';
import { VerifiedProfileRepository } from './verified-profile.repository';

/**
 * Пол и год анкеты Verified в панели (race-results-07, `profiles.verified_edit` — только admin). Правка — транзакция:
 * **первой** — условная запись анкеты (только присланные и отличающиеся поля), затем `PanelAudit.append` с именами
 * изменённых полей без значений. Значения те же — `changed: false` без журнала; анкеты нет — 404. Существующие
 * заявки не меняются. Лог — id сотрудника и исход, без значений и `userId` райдера.
 */
@Injectable()
export class ProfileVerifiedAdminService {
  private readonly logger = new Logger(ProfileVerifiedAdminService.name);

  constructor(
    private readonly repository: VerifiedProfileRepository,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(userId: string): Promise<PanelVerifiedDemographics> {
    const doc = await this.repository.find(userId);
    if (!doc) throw domainError('NOT_FOUND', 404);
    return {
      gender: doc.gender,
      birthYear: doc.birthYear,
      demographicsLocked: doc.demographicsLockedAt !== null,
    };
  }

  async update(
    actorUserId: string,
    userId: string,
    body: UpdateVerifiedDemographicsRequest,
  ): Promise<VerifiedDemographicsResult> {
    const now = this.clock.now();
    const patch: Partial<Demographics> = {};
    if (body.gender !== undefined) patch.gender = body.gender;
    if (body.birthYear !== undefined) patch.birthYear = body.birthYear;
    const result = await this.transactions.run(async (tx) => {
      const before = await this.repository.updateDemographics(tx, userId, patch, now);
      if (!before) {
        const current = await this.repository.find(userId, tx);
        if (!current) throw domainError('NOT_FOUND', 404);
        return { doc: current, changed: false };
      }
      const changedFields = (Object.keys(patch) as (keyof Demographics)[]).filter(
        (field) => before[field] !== patch[field],
      );
      await this.audit.append(tx, {
        action: 'profile.verified_demographics_changed',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
        reason: body.reason,
        details: { changedFields },
      });
      return { doc: { ...before, ...patch }, changed: true };
    });
    this.logger.log(`verified demographics edited by ${actorUserId} changed=${result.changed}`);
    return {
      gender: result.doc.gender,
      birthYear: result.doc.birthYear,
      demographicsLocked: result.doc.demographicsLockedAt !== null,
      changed: result.changed,
    };
  }
}
