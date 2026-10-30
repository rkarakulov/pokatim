import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock, ENV, MAILER, type Mailer } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';

import { type Env, panelLinkBase } from '../../../config/env';
import { renderInvitationEmail } from '../mail/panel-emails';
import { PanelInvitationEmailRequested } from '../panel.events';
import { invitationTokenMatches, panelInvitationToken } from '../panel-invitation-token';
import { PanelInvitationsRepository } from '../panel-invitations.repository';

export type PanelEmailOutcome = 'sent' | 'skipped';

/**
 * Письмо-приглашение (ADR-0026): at-least-once без захвата — дубль письма даёт ту же ссылку (токен — HMAC от id) и
 * безвреден, как «Пароль изменён». Не `pending` или истекло к отправке — `skipped`; хеш не выводится из текущего
 * секрета (ротация) — `skipped` и `emailState: 'failed'`; нет базы ссылок — ошибка (ретрай).
 * Итог — `emailState` приглашения: успех — `sent`, сбой последней попытки — `failed` («Письмо не отправлено» в блоке
 * «Приглашения») и лог `panel.invitation_email_failed`. В логах — id, без адреса и токена.
 */
@Injectable()
export class InvitationEmailHandler {
  private readonly logger = new Logger(InvitationEmailHandler.name);

  constructor(
    private readonly invitations: PanelInvitationsRepository,
    private readonly outbox: MongoOutboxReader,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV)
    private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET' | 'PANEL_LINK_BASE' | 'APP_WEB_ORIGIN'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async handle(outboxEventId: string, { final }: { final: boolean }): Promise<PanelEmailOutcome> {
    const invitationId = PanelInvitationEmailRequested.safeParse(
      await this.outbox.payloadOf(outboxEventId),
    ).data?.invitationId;
    if (!invitationId) {
      this.logger.warn(`event ${outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    try {
      const invitation = await this.invitations.findById(invitationId);
      if (
        invitation?.status !== 'pending' ||
        !invitation.email ||
        invitation.expiresAt.getTime() <= this.clock.now().getTime()
      ) {
        return 'skipped';
      }
      // секрет сменили после приглашения: новая ссылка не совпала бы с хешем в БД — письмо не шлём, провал виден
      if (
        !invitationTokenMatches(this.env.EMAIL_TOKEN_SECRET, invitation._id, invitation.tokenHash)
      ) {
        await this.invitations.setEmailState(invitation._id, 'failed');
        this.logger.warn(`panel.invitation_email_stale_secret invitation=${invitation._id}`);
        return 'skipped';
      }
      const base = panelLinkBase(this.env);
      if (base === null) throw new Error('panel link base is not configured');
      const token = panelInvitationToken(this.env.EMAIL_TOKEN_SECRET, invitation._id);
      await this.mailer.send({
        to: invitation.email,
        ...renderInvitationEmail({
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          link: `${base}invite#token=${token}`,
        }),
      });
      await this.invitations.setEmailState(invitation._id, 'sent');
      this.logger.log(`panel.invitation_email_sent invitation=${invitation._id}`);
      return 'sent';
    } catch (error) {
      if (final) {
        await this.invitations.setEmailState(invitationId, 'failed');
        this.logger.error(`panel.invitation_email_failed invitation=${invitationId}`);
      }
      throw error;
    }
  }
}
