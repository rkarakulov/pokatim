import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { IdentityAccounts } from '../identity';
import { DeliveryJobs } from './delivery-jobs';
import { renderPushSummary } from './notification-texts';
import { NOTIFICATIONS_POLICY, quietUntil } from './notifications.policy';
import { type ClaimedPush, NotificationsRepository } from './notifications.repository';
import {
  DEVICE_NOT_REGISTERED,
  type PushMessage,
  PushSendError,
  PUSH_SENDER,
  type PushSender,
} from './push-sender';

export type PushOutcome = 'sent' | 'none' | 'deferred' | 'skipped' | 'limited' | 'failed';

/**
 * Push пользователя (`notifications.push`, ADR-0017 п. 4). Захват (`claimPush`) берёт все его уведомления к сроку —
 * повтор задачи и параллельная задача того же пользователя захватывают уже нечего (`none`). Затем — в момент отправки
 * (RC-13): `PUSH_ENABLED`, живой аккаунт (RC-4), тумблер группы, тихие часы (сейчас тихо — назад в `pending` до конца
 * интервала и задача на этот срок), токены живых сессий (токены мёртвых снимаются), лимит 20/ч (после захвата:
 * повтор лимит не тратит; ретрай после сбоя отправки — тоже, `limitCharged`). Одно сообщение на
 * токен: одно уведомление — его текст и цель, несколько — сводка без цели (N7). Тикет `DeviceNotRegistered` снимает
 * токен сразу, остальные `ok` — в `push_tickets` (квитанции). Сбой отправки — захват снят, ретрай BullMQ; последняя
 * попытка — `failed`. Остаточный риск at-least-once: Expo принял, worker упал до записи `sent`. Токены в логи не
 * попадают.
 */
@Injectable()
export class PushDelivery {
  private readonly logger = new Logger(PushDelivery.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly identity: IdentityAccounts,
    private readonly rateLimiter: RateLimiter,
    private readonly jobs: DeliveryJobs,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    @Inject(ENV) private readonly env: Pick<Env, 'PUSH_ENABLED'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async deliver(userId: string, { final }: { final: boolean }): Promise<PushOutcome> {
    const now = this.clock.now();
    const claimId = uuidv7();
    const claimed = await this.repository.claimPush(
      userId,
      now,
      claimId,
      new Date(now.getTime() + NOTIFICATIONS_POLICY.deliveryLeaseMs),
    );
    if (claimed.length === 0) return 'none';
    const skip = (reason: string, ids: readonly string[] | null = null) =>
      this.repository.settlePush(claimId, ids, { state: 'skipped', reason });

    if (!this.env.PUSH_ENABLED) {
      await skip('push_off');
      return 'skipped';
    }
    if (!(await this.identity.liveUserIds([userId])).has(userId)) {
      await skip('deleted');
      return 'skipped';
    }
    const settings = (await this.repository.findSettings(userId)) ?? DEFAULT_NOTIFICATION_SETTINGS;
    const disabled = claimed.filter((doc) => !settings.push[doc.group]).map((doc) => doc._id);
    if (disabled.length > 0) await skip('disabled', disabled);
    const due = claimed.filter((doc) => settings.push[doc.group]);
    if (due.length === 0) return 'skipped';

    const quietEnd = quietUntil(now, settings.quietHours);
    if (quietEnd) {
      await this.repository.settlePush(claimId, null, { state: 'pending', notBefore: quietEnd });
      await this.jobs.schedulePush(userId, quietEnd);
      return 'deferred';
    }
    const tokens = await this.liveTokensOf(userId, now);
    if (tokens.length === 0) {
      await skip('no_tokens');
      return 'skipped';
    }
    // повтор после сбоя отправки лимит не списывает: его уже списала упавшая попытка
    const charged = due.every((doc) => doc.push.limitCharged === true);
    const limited = charged
      ? { allowed: true as const }
      : await this.rateLimiter.consume(
          `notifications-push:${userId}`,
          NOTIFICATIONS_POLICY.pushLimit,
          now,
        );
    if (!limited.allowed) {
      await this.repository.settlePush(claimId, null, { state: 'limited', reason: 'rate_limit' });
      this.logger.log(`notifications.push_limited uid=${userId} count=${due.length}`);
      return 'limited';
    }

    const content = contentOf(due);
    const messages: PushMessage[] = tokens.map((token) => ({ to: token.token, ...content }));
    let tickets;
    try {
      tickets = await this.sender.send(messages);
    } catch (error) {
      const reason = error instanceof PushSendError ? error.kind : 'error';
      if (final) {
        await this.repository.settlePush(claimId, null, { state: 'failed', reason });
        this.logger.error(`notifications.push_failed uid=${userId} count=${due.length}`);
      } else {
        await this.repository.settlePush(claimId, null, { state: 'pending', limitCharged: true });
      }
      throw error;
    }

    const unregistered: string[] = [];
    const accepted: { ticketId: string; tokenId: string }[] = [];
    let firstError: string | null = null;
    tickets.forEach((ticket, index) => {
      const tokenId = tokens[index]!._id;
      if (ticket.status === 'ok') {
        accepted.push({ ticketId: ticket.id, tokenId });
        return;
      }
      firstError ??= ticket.error ?? 'error';
      if (ticket.error === DEVICE_NOT_REGISTERED) unregistered.push(tokenId);
    });
    const removed = await this.repository.deleteTokens(unregistered);
    await this.repository.insertTickets(accepted, now);
    const sentAt = this.clock.now();
    if (accepted.length > 0) {
      await this.repository.settlePush(claimId, null, { state: 'sent', sentAt });
    } else {
      await this.repository.settlePush(claimId, null, {
        state: 'failed',
        reason: firstError ?? 'error',
      });
    }
    this.logger.log(
      `notifications.push uid=${userId} count=${due.length} tokens=${tokens.length} accepted=${accepted.length} unregistered=${removed}`,
    );
    return accepted.length > 0 ? 'sent' : 'failed';
  }

  /**
   * Токены под живыми сессиями пользователя (порт identity, одной пачкой). Токены мёртвых сессий (выход, сброс
   * пароля, отзыв, reuse detection) и записанные без сессии снимаются сразу.
   */
  private async liveTokensOf(userId: string, now: Date) {
    const tokens = await this.repository.tokensOf(userId);
    const sessionIds = [
      ...new Set(tokens.flatMap((token) => (token.sessionId ? [token.sessionId] : []))),
    ];
    const live = await this.identity.liveSessionIds(userId, sessionIds, now);
    const isLive = (token: (typeof tokens)[number]) =>
      token.sessionId !== undefined && live.has(token.sessionId);
    const dead = tokens.filter((token) => !isLive(token)).map((token) => token._id);
    const removed = await this.repository.deleteTokens(dead);
    if (removed > 0)
      this.logger.log(`notifications.token_session_ended uid=${userId} count=${removed}`);
    return tokens.filter(isLive);
  }
}

/** Одно уведомление — его текст и цель; несколько — сводка «У вас N новых уведомлений» без цели (N7). */
function contentOf(due: readonly ClaimedPush[]): Omit<PushMessage, 'to'> {
  const [only] = due;
  if (due.length === 1 && only) return { title: only.title, body: only.body, target: only.target };
  return { ...renderPushSummary(due.length), target: null };
}
