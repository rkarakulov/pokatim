import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, MAILER, type Mailer } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';

import { type Env, panelLinkBase } from '../../../config/env';
import { IdentityAccounts } from '../../identity';
import { renderRoleEmail, type RoleEmailAction } from '../mail/panel-emails';
import { PanelRoleEmailRequested } from '../panel.events';
import { PanelRepository } from '../panel.repository';
import type { PanelEmailOutcome } from './invitation-email.handler';

const ACTIONS: Partial<Record<string, RoleEmailAction>> = {
  'panel.role_granted': 'granted',
  'panel.role_changed': 'changed',
  'panel.role_revoked': 'revoked',
};

/**
 * Письмо сотруднику о выдаче, смене или снятии роли (ADR-0026): запись журнала по id (только `role_*`, иначе
 * `skipped`), адрес — `IdentityAccounts.emailsOf` в момент отправки (удалён — `skipped`). At-least-once без захвата:
 * дубль информационного письма принят (RC-7). Последний провал — лог `panel.role_email_failed` и failed-набор BullMQ.
 * Без причины и имён; в логах — id записи.
 */
@Injectable()
export class RoleEmailHandler {
  private readonly logger = new Logger(RoleEmailHandler.name);

  constructor(
    private readonly repository: PanelRepository,
    private readonly accounts: IdentityAccounts,
    private readonly outbox: MongoOutboxReader,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Pick<Env, 'PANEL_LINK_BASE' | 'APP_WEB_ORIGIN'>,
  ) {}

  async handle(outboxEventId: string, { final }: { final: boolean }): Promise<PanelEmailOutcome> {
    const auditId = PanelRoleEmailRequested.safeParse(await this.outbox.payloadOf(outboxEventId))
      .data?.auditId;
    if (!auditId) {
      this.logger.warn(`event ${outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    try {
      const entry = await this.repository.findAuditById(auditId);
      const action = entry ? ACTIONS[entry.action] : undefined;
      if (!entry?.targetUserId || !action) return 'skipped';
      const to = (await this.accounts.emailsOf([entry.targetUserId])).get(entry.targetUserId);
      if (!to) return 'skipped';
      await this.mailer.send({
        to,
        ...renderRoleEmail({
          action,
          roleFrom: entry.details?.roleFrom ?? null,
          roleTo: entry.details?.roleTo ?? null,
          link: panelLinkBase(this.env),
        }),
      });
      this.logger.log(`panel.role_email_sent audit=${auditId}`);
      return 'sent';
    } catch (error) {
      if (final) this.logger.error(`panel.role_email_failed audit=${auditId}`);
      throw error;
    }
  }
}
