import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DEVICE_PROVIDERS,
  type DeviceList,
  type DeviceProvider,
  type DeviceView,
  type RateLimitedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter, REDIS } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, MongoTransactions } from '@rkarakulov/api-kit/mongo';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { DeviceAudit } from './device-audit';
import { DevicesPullQueue } from './devices-jobs';
import type { DeviceConnectionDoc } from './devices.collection';
import { DEVICES_REVOKE_REQUESTED, type DevicesRevokeRequested } from './devices.events';
import { DEVICES_POLICY } from './devices.policy';
import { DevicesRepository } from './devices.repository';
import { WEARABLES_AGGREGATOR, type WearablesAggregator } from './wearables-aggregator';

/** Кеш каталога провайдеров агрегатора (только успешный ответ). */
const CATALOG_CACHE_KEY = 'devices:providers';
const CachedCatalog = z.array(
  z.object({ provider: z.string(), name: z.string(), enabled: z.boolean() }),
);
export type ProviderCatalog = ReadonlyMap<string, { name: string; enabled: boolean }>;

const FALLBACK_NAMES: Record<DeviceProvider, string> = { garmin: 'Garmin', wahoo: 'Wahoo' };

/**
 * Экран «Устройства» (под `AuthGuard`): провайдеры = живой каталог агрегатора ∩ allowlist (кеш Redis 5 мин; агрегатор
 * недоступен или устройства выключены — `available: false`, ответ всё равно 200), статусы своих подключений,
 * «Синхронизировать сейчас» и отключение. Ответы — без идентификаторов агрегатора и тикетов (§8.3 п. 3).
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly repository: DevicesRepository,
    private readonly audit: DeviceAudit,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    private readonly pulls: DevicesPullQueue,
    @Inject(WEARABLES_AGGREGATOR) private readonly aggregator: WearablesAggregator,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string): Promise<DeviceList> {
    const [catalog, connections] = await Promise.all([
      this.catalog(),
      this.repository.listUserConnections(userId),
    ]);
    const items = DEVICE_PROVIDERS.filter((provider) =>
      this.env.DEVICE_PROVIDERS_ALLOWLIST.includes(provider),
    ).map((provider) =>
      toView(
        provider,
        catalog?.get(provider),
        connections.filter((connection) => connection.provider === provider),
        this.env.DEVICES_ENABLED,
      ),
    );
    return { items };
  }

  /** Провайдер подключаем: устройства включены, в allowlist и включён в агрегаторе. */
  async isAvailable(provider: DeviceProvider): Promise<boolean> {
    if (!this.env.DEVICES_ENABLED || !this.env.DEVICE_PROVIDERS_ALLOWLIST.includes(provider)) {
      return false;
    }
    return (await this.catalog())?.get(provider)?.enabled === true;
  }

  /**
   * «Синхронизировать сейчас» (лимит 1/10 мин на подключение): `requestSync` в агрегаторе (ошибка — лог, pull всё
   * равно идёт) + pull через 30 с и ещё один через 3 мин (агрегатор тянет у провайдера асинхронно).
   */
  async sync(userId: string, provider: DeviceProvider): Promise<DeviceList> {
    const connection = await this.repository.findLiveConnection(userId, provider);
    if (!connection || connection.status !== 'active') throw domainError('NOT_FOUND', 404);
    const limit = await this.rateLimiter.consume(
      `devices-sync:${connection._id}`,
      DEVICES_POLICY.syncLimit,
      this.clock.now(),
    );
    if (!limit.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limit.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    try {
      await this.aggregator.requestSync(connection.aggUserId, provider);
    } catch {
      this.logger.warn(`devices.request_sync_failed connection=${connection._id}`);
    }
    const [soon, late] = DEVICES_POLICY.syncFollowUpDelaysMs;
    await this.pulls.schedule(connection._id, 'sync', soon);
    await this.pulls.schedule(connection._id, 'sync-late', late);
    return this.list(userId);
  }

  /**
   * Отключение: транзакция { `disconnecting`, журнал, outbox `devices.revoke-requested` } → worker отзывает в
   * агрегаторе и (с галочкой) удаляет загрузки провайдера. Нечего отключать — 404.
   */
  async disconnect(
    userId: string,
    provider: DeviceProvider,
    deleteActivities: boolean,
  ): Promise<DeviceList> {
    const connection = await this.repository.findLiveConnection(userId, provider);
    if (!connection || connection.status === 'disconnecting') throw domainError('NOT_FOUND', 404);
    const changed = await this.transactions.run(async (session) => {
      const updated = await this.repository.requestDisconnect(session, connection._id, [
        'pending',
        'active',
      ]);
      if (!updated) return false;
      await this.audit.append(session, {
        userId,
        provider,
        connectionId: connection._id,
        action: 'disconnected',
        reason: 'user',
      });
      const payload: DevicesRevokeRequested = {
        connectionId: connection._id,
        reason: 'user',
        deleteActivities,
      };
      await this.outbox.append(session, { type: DEVICES_REVOKE_REQUESTED, payload });
      return true;
    });
    if (!changed) throw domainError('NOT_FOUND', 404);
    this.logger.log(`devices.disconnect_requested connection=${connection._id}`);
    return this.list(userId);
  }

  /** Каталог агрегатора: кеш Redis 5 мин; агрегатор недоступен — `null` (провайдеры недоступны). */
  async catalog(): Promise<ProviderCatalog | null> {
    if (!this.env.DEVICES_ENABLED) return null;
    const cached = await this.redis.get(CATALOG_CACHE_KEY).catch(() => null);
    if (cached) {
      const parsed = CachedCatalog.safeParse(safeJson(cached));
      if (parsed.success) return toCatalog(parsed.data);
    }
    try {
      const rows = (await this.aggregator.listProviders()).map(({ provider, name, enabled }) => ({
        provider,
        name,
        enabled,
      }));
      await this.redis
        .set(CATALOG_CACHE_KEY, JSON.stringify(rows), 'EX', DEVICES_POLICY.providersCacheSec)
        .catch(() => undefined);
      return toCatalog(rows);
    } catch {
      this.logger.warn('devices.catalog_unavailable');
      return null;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toCatalog(rows: { provider: string; name: string; enabled: boolean }[]): ProviderCatalog {
  return new Map(
    rows.map((row) => [row.provider.toLowerCase(), { name: row.name, enabled: row.enabled }]),
  );
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Строка экрана: живое подключение — его статус и проблема; последнее отозванное с неудачным отзывом — `revoked` +
 * `revoke_failed` (подсказка отозвать у провайдера); иначе — `not_connected`.
 */
function toView(
  provider: DeviceProvider,
  entry: { name: string; enabled: boolean } | undefined,
  connections: DeviceConnectionDoc[],
  enabled: boolean,
): DeviceView {
  const live = connections.find((connection) => connection.status !== 'revoked');
  const [latest] = connections;
  const base = {
    provider,
    name: entry?.name || FALLBACK_NAMES[provider],
    available: enabled && entry?.enabled === true,
  };
  if (live) {
    return {
      ...base,
      status: live.status,
      issue: live.issue,
      connectedAt: iso(live.connectedAt),
      lastSyncedAt: iso(live.lastSyncedAt),
    };
  }
  if (latest?.revokeFailed) {
    return {
      ...base,
      status: 'revoked',
      issue: 'revoke_failed',
      connectedAt: null,
      lastSyncedAt: iso(latest.lastSyncedAt),
    };
  }
  return { ...base, status: 'not_connected', issue: null, connectedAt: null, lastSyncedAt: null };
}
