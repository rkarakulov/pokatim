import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  API_VERSION,
  type ConnectDeviceResponse,
  DeviceLinkTicket,
  type DeviceList,
  type DeviceProvider,
  type RateLimitedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { randomToken, sha256 } from '../identity';
import { DeviceAudit } from './device-audit';
import { ACCOUNT_LOCK, accountLockKey, DevicesLocks } from './devices-jobs';
import type { DeviceConnectionDoc, DeviceLinkTicketDoc } from './devices.collection';
import {
  DEVICES_CONNECTED,
  DEVICES_REVOKE_REQUESTED,
  type DevicesConnected,
  type DevicesRevokeRequested,
} from './devices.events';
import { aggregatorExternalId, DEVICES_POLICY, isAllowedReturnUrl } from './devices.policy';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import {
  AggregatorError,
  WEARABLES_AGGREGATOR,
  type WearablesAggregator,
} from './wearables-aggregator';

/** Один ответ на чужой, истёкший, повторный, неподтверждённый тикет (§8.3 п. 3). */
const linkInvalid = () => domainError('DEVICE_LINK_INVALID', 400);
const providerError = (error: unknown) => {
  if (error instanceof AggregatorError) return domainError('DEVICE_PROVIDER_ERROR', 503);
  return error;
};

/**
 * Подключение провайдера через агрегатор (R4, §7): `connect` (под входом) → пользователь агрегатора (лениво, под
 * Redis-замком) → `pending` + одноразовый тикет (в БД — sha256, TTL 30 мин) → ссылка авторизации агрегатора с
 * `redirect_uri = <PUBLIC_API_ORIGIN>/v1/devices/callback?t=<тикет>`; callback (без входа) только перенаправляет в
 * приложение; `complete` владельца тикета подтверждает подключение в агрегаторе и активирует его. Чужой `complete` —
 * отзыв подключения инициатора. Тикет, `authorizeUrl` и id агрегатора в логи не пишутся.
 */
@Injectable()
export class DevicesLinkService {
  private readonly logger = new Logger(DevicesLinkService.name);

  constructor(
    private readonly repository: DevicesRepository,
    private readonly devices: DevicesService,
    private readonly audit: DeviceAudit,
    private readonly locks: DevicesLocks,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(WEARABLES_AGGREGATOR) private readonly aggregator: WearablesAggregator,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async connect(
    userId: string,
    provider: DeviceProvider,
    returnUrl: string,
  ): Promise<ConnectDeviceResponse> {
    if (!this.env.DEVICES_ENABLED || !this.env.DEVICE_PROVIDERS_ALLOWLIST.includes(provider)) {
      throw domainError('DEVICE_PROVIDER_UNAVAILABLE', 409);
    }
    if (!isAllowedReturnUrl(returnUrl, this.env.DEVICE_RETURN_URLS)) {
      throw domainError('VALIDATION_FAILED', 400);
    }
    const limit = await this.rateLimiter.consume(
      `devices-connect:${userId}`,
      DEVICES_POLICY.connectLimit,
      this.clock.now(),
    );
    if (!limit.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limit.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    if (!(await this.devices.isAvailable(provider)))
      throw domainError('DEVICE_PROVIDER_UNAVAILABLE', 409);

    const live = await this.repository.findLiveConnection(userId, provider);
    if (
      live &&
      (live.status === 'disconnecting' ||
        (live.status === 'active' && live.issue !== 'reauthorize'))
    ) {
      throw domainError('CONFLICT', 409);
    }

    try {
      const aggUserId = await this.ensureAccount(userId);
      const now = this.clock.now();
      const expiresAt = new Date(now.getTime() + DEVICES_POLICY.ticketTtlMs);
      const connection = await this.pendingConnection(userId, provider, aggUserId, live, expiresAt);
      const ticket = randomToken();
      const ticketDoc: DeviceLinkTicketDoc = {
        _id: sha256(ticket),
        userId,
        provider,
        connectionId: connection._id,
        returnUrl,
        expiresAt,
      };
      await this.repository.insertTicket(ticketDoc);
      const redirectUri = new URL(`/${API_VERSION}/devices/callback`, this.env.PUBLIC_API_ORIGIN);
      redirectUri.searchParams.set('t', ticket);
      const { authorizeUrl } = await this.aggregator.createAuthorization({
        aggUserId,
        provider,
        redirectUri: redirectUri.toString(),
      });
      this.logger.log(`devices.connect_started connection=${connection._id} provider=${provider}`);
      return { authorizeUrl };
    } catch (error) {
      throw providerError(error);
    }
  }

  /**
   * Пользователь агрегатора — один на пользователя pokatim: замок Redis `devices:account:<userId>` (SET NX PX, ждём
   * освобождения) → перечитать `device_accounts` → создать в агрегаторе (`external_user_id`, без ПДн) → сохранить.
   * Два параллельных `connect` — один вызов создания (второй ждёт замок и находит запись).
   */
  async ensureAccount(userId: string): Promise<string> {
    const existing = await this.repository.findAccount(userId);
    if (existing) return existing.aggUserId;
    const key = accountLockKey(userId);
    const token = await this.locks.acquire(key, ACCOUNT_LOCK.ttlMs, ACCOUNT_LOCK.waitMs);
    if (!token) throw domainError('DEVICE_PROVIDER_ERROR', 503);
    try {
      const again = await this.repository.findAccount(userId);
      if (again) return again.aggUserId;
      const aggUserId = await this.aggregator.ensureUser(
        aggregatorExternalId(this.env.OW_EXTERNAL_ID_PREFIX, userId),
      );
      const saved = await this.repository.insertAccount({
        _id: userId,
        aggregator: this.env.DEVICES_AGGREGATOR,
        aggUserId,
        createdAt: this.clock.now(),
      });
      return saved.aggUserId;
    } finally {
      await this.locks.release(key, token);
    }
  }

  /** `pending` для авторизации: новый документ или повторная авторизация того же (`pending`, `reauthorize`). */
  private async pendingConnection(
    userId: string,
    provider: DeviceProvider,
    aggUserId: string,
    live: DeviceConnectionDoc | undefined,
    pendingUntil: Date,
  ): Promise<DeviceConnectionDoc> {
    if (live) {
      const reopened = await this.repository.reopenPending(live._id, pendingUntil);
      if (reopened) return reopened;
      throw domainError('CONFLICT', 409);
    }
    const doc: DeviceConnectionDoc = {
      _id: uuidv7(),
      userId,
      aggUserId,
      provider,
      status: 'pending',
      issue: null,
      pendingUntil,
      connectedAt: null,
      lastSyncedAt: null,
      catchUpUntil: null,
      failedImports: 0,
      revokedAt: null,
      revokedReason: null,
      revokeFailed: false,
      version: 0,
    };
    if (await this.repository.insertConnection(doc)) return doc;
    // параллельный connect того же провайдера успел первым — продолжаем с его документом
    const raced = await this.repository.findLiveConnection(userId, provider);
    if (raced?.status === 'pending') {
      const reopened = await this.repository.reopenPending(raced._id, pendingUntil);
      if (reopened) return reopened;
    }
    throw domainError('CONFLICT', 409);
  }

  /**
   * Возврат из агрегатора (без входа): живой тикет → `returnUrl` тикета с `provider`, `result=pending` и тикетом;
   * иначе — web-ссылка возврата по умолчанию с `result=error`. Ничего не меняет (повторный заход — тот же адрес).
   */
  async callbackLocation(rawTicket: unknown): Promise<string> {
    const ticket = DeviceLinkTicket.safeParse(rawTicket);
    const found = ticket.success
      ? await this.repository.findLiveTicket(sha256(ticket.data), this.clock.now())
      : undefined;
    if (!found || !ticket.success) return this.errorLocation();
    const location = new URL(found.returnUrl);
    location.searchParams.set('provider', found.provider);
    location.searchParams.set('result', 'pending');
    location.searchParams.set('t', ticket.data);
    return location.toString();
  }

  private errorLocation(): string {
    const fallback =
      this.env.DEVICE_RETURN_URLS.find((url) => url.startsWith('https://')) ??
      this.env.DEVICE_RETURN_URLS[0];
    if (!fallback) return '/';
    const location = new URL(fallback);
    location.searchParams.set('result', 'error');
    return location.toString();
  }

  /**
   * Активация владельцем тикета: тикет гасится атомарно (`findOneAndDelete`); чужой — `DEVICE_LINK_INVALID` и отзыв
   * подключения инициатора; агрегатор подтверждает подключение провайдера → транзакция { `active`, журнал, outbox
   * `devices.connected` } → история и первый pull. Нет подключения в агрегаторе — `DEVICE_LINK_INVALID` (`pending`
   * остаётся до уборки).
   */
  async complete(userId: string, provider: DeviceProvider, ticket: string): Promise<DeviceList> {
    const now = this.clock.now();
    const taken = await this.repository.takeTicket(sha256(ticket), now);
    if (!taken) throw linkInvalid();
    if (taken.userId !== userId) {
      await this.revokeForeign(taken);
      throw linkInvalid();
    }
    const connection = await this.repository.findConnection(taken.connectionId);
    if (
      taken.provider !== provider ||
      connection?.userId !== userId ||
      connection.status !== 'pending'
    ) {
      throw linkInvalid();
    }

    let linked: boolean;
    try {
      const remote = await this.aggregator.listConnections(connection.aggUserId);
      linked = remote.some((item) => item.provider === provider && item.status === 'active');
    } catch (error) {
      throw providerError(error);
    }
    if (!linked) throw linkInvalid();

    const catchUpUntil = new Date(now.getTime() + DEVICES_POLICY.catchUpMs);
    const activated = await this.transactions.run(async (session) => {
      const updated = await this.repository.activate(
        session,
        connection._id,
        userId,
        now,
        catchUpUntil,
      );
      if (!updated) return false;
      await this.audit.append(session, {
        userId,
        provider,
        connectionId: connection._id,
        action: 'connected',
      });
      const payload: DevicesConnected = { connectionId: connection._id };
      await this.outbox.append(session, { type: DEVICES_CONNECTED, payload });
      return true;
    });
    if (!activated) throw linkInvalid();
    this.logger.log(`devices.connected connection=${connection._id} provider=${provider}`);
    return this.devices.list(userId);
  }

  /** Тикет погасил не инициатор: подключение инициатора не активируется, а отзывается в агрегаторе (§8.3 п. 1). */
  private async revokeForeign(ticket: DeviceLinkTicketDoc): Promise<void> {
    const revoked = await this.transactions.run(async (session) => {
      const updated = await this.repository.requestDisconnect(session, ticket.connectionId, [
        'pending',
      ]);
      if (!updated) return false;
      await this.audit.append(session, {
        userId: updated.userId,
        provider: updated.provider,
        connectionId: updated._id,
        action: 'disconnected',
        reason: 'foreign_ticket',
      });
      const payload: DevicesRevokeRequested = {
        connectionId: updated._id,
        reason: 'foreign_ticket',
        deleteActivities: false,
      };
      await this.outbox.append(session, { type: DEVICES_REVOKE_REQUESTED, payload });
      return true;
    });
    this.logger.warn(`devices.foreign_ticket connection=${ticket.connectionId} revoked=${revoked}`);
  }
}
