import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { IdentityAccounts } from '../identity';
import { type PublicRiderCard, RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { DeliveryJobs } from './delivery-jobs';
import { renderPushSummary } from './notification-texts';
import {
  DEFAULT_DELIVERY_SETTINGS,
  NOTIFICATIONS_POLICY,
  quietUntil,
} from './notifications.policy';
import {
  type ClaimedPush,
  NotificationsRepository,
  type PushTokenSnapshot,
} from './notifications.repository';
import {
  DEVICE_NOT_REGISTERED,
  type PushMessage,
  PushSendError,
  PUSH_SENDER,
  type PushSender,
} from './push-sender';
import { renderSocialNotice } from './social-notices';
import { WEB_PUSH_SENDER, type WebPushSender } from './web-push.sender';

export type PushOutcome = 'sent' | 'none' | 'deferred' | 'skipped' | 'limited' | 'failed';

/**
 * Push пользователя (`notifications.push`, ADR-0017 п. 4). Захват (`claimPush`) берёт все его уведомления к сроку —
 * повтор задачи и параллельная задача того же пользователя захватывают уже нечего (`none`). Транспорта два: Expo
 * (`PUSH_ENABLED`) и Web Push (ADR-0022, `WEB_PUSH_SENDER` есть — включён); канал выключен, только если оба. Затем —
 * в момент отправки (RC-13): живой аккаунт (RC-4), тумблер группы, тихие часы (сейчас тихо — назад в `pending` до конца
 * интервала и задача на этот срок), токены живых сессий (токены мёртвых снимаются), лимит 20/ч (после захвата:
 * повтор лимит не тратит; ретрай после сбоя отправки — тоже, `limitCharged`). Одно сообщение на
 * токен: одно уведомление — его текст и цель, несколько — сводка без цели (N7). Тикет `DeviceNotRegistered` и ответ
 * Web Push 404/410 снимают токен сразу, остальные `ok` Expo — в `push_tickets` (квитанции). Сбой Expo или
 * недоступность push-сервисов браузера, когда никто не принял, — захват снят, ретрай BullMQ; последняя попытка —
 * `failed`. Сбой Expo не мешает Web Push: принял хоть кто-то — `sent` без ретрая. Остаточный риск at-least-once: Expo принял, worker упал до записи `sent`. Токены в логи не
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
    @Inject(WEB_PUSH_SENDER) private readonly webSender: WebPushSender | null,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
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

    const expoOn = this.env.PUSH_ENABLED;
    const webOn = this.webSender !== null;
    if (!expoOn && !webOn) {
      await skip('push_off');
      return 'skipped';
    }
    if (!(await this.identity.liveUserIds([userId])).has(userId)) {
      await skip('deleted');
      return 'skipped';
    }
    const settings = (await this.repository.findSettings(userId)) ?? DEFAULT_DELIVERY_SETTINGS;
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
    // токены выключенного транспорта не трогаются и не считаются
    const usable = (await this.liveTokensOf(userId, now)).filter((token) =>
      token.platform === 'web' ? webOn && token.webPush !== undefined : expoOn,
    );
    if (usable.length === 0) {
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

    const content = contentOf(due, await this.socialCards(userId, due));
    const expoTokens = usable.filter((token) => token.platform !== 'web');
    const webTokens = usable.filter((token) => token.platform === 'web');
    const unregistered: PushTokenSnapshot[] = [];
    const accepted: { ticketId: string; tokenId: string }[] = [];
    let firstError: string | null = null;

    // Expo недоступен — Web Push всё равно уходит; ретрай — только если не принял никто (дублей на ретрае нет)
    let expoError: unknown = null;
    if (expoTokens.length > 0) {
      try {
        const tickets = await this.sender.send(
          expoTokens.map((token) => ({ to: token.token, ...content })),
        );
        tickets.forEach((ticket, index) => {
          const token = expoTokens[index]!;
          if (ticket.status === 'ok') {
            accepted.push({ ticketId: ticket.id, tokenId: token._id });
            return;
          }
          firstError ??= ticket.error ?? 'error';
          if (ticket.error === DEVICE_NOT_REGISTERED) unregistered.push(snapshotOf(userId, token));
        });
      } catch (error) {
        expoError = error;
      }
    }

    let webAccepted = 0;
    let webUnavailable = false;
    const results = await Promise.all(
      webTokens.map((token) =>
        this.webSender!.send({ endpoint: token.token, ...token.webPush! }, content),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === 'ok') {
        webAccepted += 1;
        return;
      }
      if (result.status === 'gone') {
        firstError ??= 'gone';
        unregistered.push(snapshotOf(userId, webTokens[index]!));
        return;
      }
      firstError ??= result.code;
      if (result.kind === 'unavailable') webUnavailable = true;
    });

    const removed = await this.repository.deleteTokens(unregistered);
    await this.repository.insertTickets(userId, accepted, now);
    const delivered = accepted.length + webAccepted;
    // никто не принял, а Expo или push-сервис браузера временно недоступны — повтор задачи
    if (delivered === 0 && (expoError !== null || webUnavailable)) {
      const error =
        expoError ?? new PushSendError('unavailable', null, 'web push service unavailable');
      await this.sendFailed(claimId, userId, due.length, final, error);
      throw error;
    }
    const sentAt = this.clock.now();
    if (delivered > 0) {
      await this.repository.settlePush(claimId, null, { state: 'sent', sentAt });
    } else {
      await this.repository.settlePush(claimId, null, {
        state: 'failed',
        reason: firstError ?? 'error',
      });
    }
    this.logger.log(
      `notifications.push uid=${userId} count=${due.length} tokens=${usable.length} web=${webTokens.length} accepted=${delivered} unregistered=${removed}`,
    );
    return delivered > 0 ? 'sent' : 'failed';
  }

  /**
   * Имена «Своих» для одного уведомления — на момент отправки (тихие часы: лица, добавленные за ожиданием, — в тексте).
   * Захват и лимит уже за спиной: сбой запроса имён не роняет доставку — пустая карта, уходит запасной текст документа
   * («Райдер», цель `rider` — `null`, RC-3); в логе — `uid` и класс ошибки, без имён.
   */
  private async socialCards(
    userId: string,
    due: readonly ClaimedPush[],
  ): Promise<ReadonlyMap<string, PublicRiderCard>> {
    const [only] = due;
    const actors = due.length === 1 && only?.group === 'social' ? (only.actors ?? []) : [];
    if (actors.length === 0) return new Map();
    try {
      return await this.names.publicRiders(actors);
    } catch (error) {
      const kind = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`notifications.push_names_failed uid=${userId} error=${kind}`);
      return new Map();
    }
  }

  /** Сбой отправки: последняя попытка — `failed`, иначе захват снят (`pending`), лимит уже списан. */
  private async sendFailed(
    claimId: string,
    userId: string,
    count: number,
    final: boolean,
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof PushSendError ? error.kind : 'error';
    if (final) {
      await this.repository.settlePush(claimId, null, { state: 'failed', reason });
      this.logger.error(`notifications.push_failed uid=${userId} count=${count}`);
    } else {
      await this.repository.settlePush(claimId, null, { state: 'pending', limitCharged: true });
    }
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
    const dead = tokens.filter((token) => !isLive(token)).map((token) => snapshotOf(userId, token));
    const removed = await this.repository.deleteTokens(dead);
    if (removed > 0)
      this.logger.log(`notifications.token_session_ended uid=${userId} count=${removed}`);
    return tokens.filter(isLive);
  }
}

/** Снимок прочитанного токена: снятие не тронет документ, перерегистрированный после чтения. */
const snapshotOf = (
  userId: string,
  token: { _id: string; sessionId?: string },
): PushTokenSnapshot => ({ _id: token._id, userId, sessionId: token.sessionId ?? null });

/**
 * Одно уведомление — его текст и цель («Свои» — с именами `cards`, `renderSocialNotice`); несколько — сводка «У вас N
 * новых уведомлений» без цели и имён (N7).
 */
function contentOf(
  due: readonly ClaimedPush[],
  cards: ReadonlyMap<string, PublicRiderCard>,
): Omit<PushMessage, 'to'> {
  const [only] = due;
  if (due.length === 1 && only) {
    const stored = { title: only.title, body: only.body, target: only.target };
    return only.group === 'social' ? renderSocialNotice({ ...only, ...stored }, cards) : stored;
  }
  return { ...renderPushSummary(due.length), target: null };
}
