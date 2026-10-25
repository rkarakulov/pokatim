import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PanelMe, PanelSignInResponse } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { IdentityAccounts, PanelCredentials, randomToken, sha256 } from '../identity';
import type { PanelPrincipal } from './current-panel-user.decorator';
import { PanelAudit } from './panel-audit';
import { DELETED_MEMBER, PANEL_POLICY } from './panel.policy';
import { PanelRepository } from './panel.repository';
import { PanelSessionCheck } from './panel-session-check';
import { permissionsOf } from './permissions';

export type PanelSignInResult =
  | { state: 'signedIn'; me: PanelMe; token: string; expiresAt: Date }
  | Extract<PanelSignInResponse, { state: 'verificationRequired' }>;

/**
 * Сессия панели (ADR-0009, R1): вход только паролем через порт identity, отдельная серверная сессия (токен в cookie,
 * в БД — sha256), выход. Проверка на каждом запросе — `PanelGuard`.
 */
@Injectable()
export class PanelSessionService {
  private readonly logger = new Logger('PanelSession');

  constructor(
    private readonly credentials: PanelCredentials,
    private readonly accounts: IdentityAccounts,
    private readonly repository: PanelRepository,
    private readonly check: PanelSessionCheck,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Вход: пароль (лимиты и 401 — как у приложения) → `verificationRequired` как есть → член команды `active`, иначе
   * `403 PANEL_ACCESS_DENIED` (только после верного пароля; сессии и записи журнала нет) → сессия + `panel.signed_in`
   * и отзыв прежней cookie этого браузера (`superseded`) одной транзакцией.
   * Гонки «вход ↔ снятие роли / сброс пароля» закрывает гард: роль и штамп проверяются на каждом запросе.
   */
  async signIn(
    input: { email: string; password: string },
    ip: string,
    previousToken: string | undefined,
  ): Promise<PanelSignInResult> {
    const verified = await this.credentials.verify(input, ip);
    if (verified.state === 'verificationRequired') return verified;

    const member = await this.repository.findActiveMember(verified.userId);
    if (!member) throw domainError('PANEL_ACCESS_DENIED', 403);

    const now = this.clock.now();
    const token = randomToken();
    const sessionId = uuidv7();
    const expiresAt = new Date(now.getTime() + PANEL_POLICY.sessionAbsoluteMs);
    await this.transactions.run(async (tx) => {
      await this.repository.insertSession(tx, {
        _id: sessionId,
        userId: verified.userId,
        tokenHash: sha256(token),
        credentialsStamp: verified.credentialsStamp,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + PANEL_POLICY.sessionIdleMs),
        expiresAt,
      });
      await this.audit.append(tx, {
        action: 'panel.signed_in',
        actor: { kind: 'user', userId: verified.userId },
      });
      // прежняя сессия этого браузера — в той же транзакции: сбой отзыва отменяет и вход (без живой сессии без
      // владельца в браузере и без записи о входе, которого не было)
      if (previousToken) {
        await this.repository.revokeSession(
          { tokenHash: sha256(previousToken) },
          now,
          'superseded',
          tx,
        );
      }
    });
    this.logger.log(`вход в панель uid=${verified.userId} sid=${sessionId}`);
    const me: PanelMe = {
      user: {
        id: verified.userId,
        displayName: member.displayName,
        email: verified.email,
        role: member.role,
      },
      permissions: permissionsOf(member.role),
    };
    return { state: 'signedIn', me, token, expiresAt };
  }

  /** «Кто я»: роль и права — из гарда этого запроса, имя и e-mail — одним чтением каждого. */
  async me(principal: PanelPrincipal): Promise<PanelMe> {
    const [member, emails] = await Promise.all([
      this.repository.findActiveMember(principal.userId),
      this.accounts.emailsOf([principal.userId]),
    ]);
    if (!member) throw domainError('UNAUTHORIZED', 401);
    return {
      user: {
        id: principal.userId,
        displayName: member.displayName,
        email: emails.get(principal.userId) ?? DELETED_MEMBER,
        role: principal.role,
      },
      permissions: [...principal.permissions],
    };
  }

  /**
   * Выход по cookie (идемпотентно): живая сессия отзывается вместе с записью `panel.signed_out` одной транзакцией;
   * мёртвая или чужая — ничего не меняется (ответ тот же).
   */
  async signOut(token: string | undefined): Promise<void> {
    if (!token) return;
    const now = this.clock.now();
    const session = await this.repository.findLiveSession(sha256(token), now);
    if (!session) return;
    // сессия, которую гард уже не пропустил бы (сброс пароля, снятие роли, удаление), — отзыв с его причиной, без
    // записи о выходе: сотрудника в панели уже нет
    const verdict = await this.check.verdict(session);
    if (!verdict.valid) {
      await this.repository.revokeSession({ id: session._id }, now, verdict.reason);
      return;
    }
    await this.transactions.run(async (tx) => {
      const revoked = await this.repository.revokeSession(
        { id: session._id },
        now,
        'signed_out',
        tx,
      );
      if (!revoked) return;
      await this.audit.append(tx, {
        action: 'panel.signed_out',
        actor: { kind: 'user', userId: session.userId },
      });
    });
  }
}
