import { Inject, Injectable } from '@nestjs/common';
import { type InvitationAcceptRequest, normalizeEmail } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { PanelCredentials } from '../identity';
import { invitationTokenHash, invitationTokenMatches } from './panel-invitation-token';
import { PanelInvitationsRepository } from './panel-invitations.repository';
import { invitationInvalid, PanelInvitationsService } from './panel-invitations.service';
import { type PanelSignInResult, PanelSessionService } from './panel-session.service';

/**
 * Принятие приглашения (ADR-0026) — шаг входа паролем: снимок живого приглашения по токену (нет — 410 до argon2 и
 * счётчиков `signin-*`, RC-2) → пароль тем же портом `PanelCredentials.verify` (общие лимиты, 401 как у входа;
 * `verificationRequired` — как есть, приглашение не трогается) → e-mail аккаунта = адрес приглашения (иначе 409) →
 * транзакция принятия → продолжение входа (ветки 2FA ADR-0024) без повторной проверки пароля. Cookie устройства на
 * этом пути не видна (её `Path` — `/v1/admin/session`, RC-4): «запомненное устройство» код не пропускает.
 */
@Injectable()
export class PanelInvitationAccept {
  constructor(
    private readonly invitations: PanelInvitationsRepository,
    private readonly service: PanelInvitationsService,
    private readonly credentials: PanelCredentials,
    private readonly sessions: PanelSessionService,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async accept(
    input: InvitationAcceptRequest,
    ip: string,
    previousToken: string | undefined,
  ): Promise<PanelSignInResult> {
    const snapshot = await this.invitations.findLiveByTokenHash(
      invitationTokenHash(input.token),
      this.clock.now(),
    );
    // ссылка, выданная до ротации секрета, не принимается (хеш не выводится из текущего секрета)
    if (
      !snapshot ||
      !invitationTokenMatches(this.env.EMAIL_TOKEN_SECRET, snapshot._id, snapshot.tokenHash)
    ) {
      throw invitationInvalid();
    }
    const verified = await this.credentials.verify(
      { email: input.email, password: input.password },
      ip,
    );
    if (verified.state === 'verificationRequired') return verified;
    if (normalizeEmail(verified.email) !== snapshot.email) {
      throw domainError('PANEL_INVITATION_EMAIL_MISMATCH', 409);
    }
    await this.service.acceptIn(snapshot, verified);
    return this.sessions.continueAfterCredentials(verified, previousToken, undefined);
  }
}
