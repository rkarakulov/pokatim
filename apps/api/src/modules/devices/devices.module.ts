import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { CLOCK, type Clock, ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { QUEUE } from '../../queues';
import { IdentityModule } from '../identity';
import { TracksCoreModule } from '../tracks';
import { DeviceAudit } from './device-audit';
import { DevicesCallbackController } from './devices-callback.controller';
import { DevicesLocks, DevicesPullQueue } from './devices-jobs';
import { DevicesLinkService } from './devices-link.service';
import { DevicesMaintenanceProcessor, DevicesSchedules } from './devices-maintenance.processor';
import { DevicesSyncProcessor } from './devices-sync.processor';
import { DevicesSyncService } from './devices-sync.service';
import { DevicesWebhookController } from './devices-webhook.controller';
import { DevicesWebhookService } from './devices-webhook.service';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { OpenWearablesAggregator } from './open-wearables.aggregator';
import {
  AggregatorError,
  WEARABLES_AGGREGATOR,
  type WearablesAggregator,
  WebhookSignatureError,
} from './wearables-aggregator';
import { WebhookRawBodyHook } from './webhook-raw-body';

const disabled = () => new AggregatorError('disabled', null, 'aggregator is not configured');

/** Агрегатор не настроен (`DEVICES_ENABLED=false`, нет ключа): любой вызов — `disabled`, стенд стартует без OW. */
const unconfiguredAggregator: WearablesAggregator = {
  ensureUser: () => Promise.reject(disabled()),
  createAuthorization: () => Promise.reject(disabled()),
  listConnections: () => Promise.reject(disabled()),
  revokeConnection: () => Promise.reject(disabled()),
  requestHistoricalSync: () => Promise.reject(disabled()),
  requestSync: () => Promise.reject(disabled()),
  listWorkouts: () => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(disabled()) }),
  }),
  fetchWorkoutTrack: () => Promise.reject(disabled()),
  verifyWebhook: () => {
    throw new WebhookSignatureError('webhook disabled');
  },
  listProviders: () => Promise.reject(disabled()),
};

/** Выбор адаптера по `DEVICES_AGGREGATOR` (сейчас — только Open Wearables, R6). */
const aggregatorProvider: Provider = {
  provide: WEARABLES_AGGREGATOR,
  inject: [ENV, CLOCK],
  useFactory: (env: Env, clock: Clock): WearablesAggregator => {
    if (!env.DEVICES_ENABLED || !env.OW_API_URL || !env.OW_API_KEY) return unconfiguredAggregator;
    switch (env.DEVICES_AGGREGATOR) {
      case 'open_wearables':
        return new OpenWearablesAggregator(
          {
            apiUrl: env.OW_API_URL,
            apiKey: env.OW_API_KEY,
            webhookSecret: env.OW_WEBHOOK_SECRET ?? null,
          },
          clock,
        );
    }
  },
};

const core: Provider[] = [
  DevicesRepository,
  DeviceAudit,
  DevicesLocks,
  DevicesPullQueue,
  aggregatorProvider,
];

/**
 * Устройства через агрегатор (ADR-0011), HTTP-часть: экран «Устройства», подключение (connect / callback /
 * complete), «Синхронизировать сейчас», отключение, вебхук. Тяжёлая работа (pull, отзыв, история) — только worker;
 * API ставит задачи `devices-sync` (pull) и пишет outbox. `tracks` — только через `index.ts`.
 */
@Module({
  imports: [
    IdentityModule,
    TracksCoreModule,
    BullModule.registerQueue({ name: QUEUE.devicesSync }),
  ],
  controllers: [DevicesController, DevicesCallbackController, DevicesWebhookController],
  providers: [
    ...core,
    DevicesService,
    DevicesLinkService,
    DevicesWebhookService,
    WebhookRawBodyHook,
  ],
})
export class DevicesModule {}

/** Задачи устройств в worker: pull и импорт, история, отзыв, надгробия; регламент и его расписания. */
@Module({
  imports: [
    TracksCoreModule,
    BullModule.registerQueue({ name: QUEUE.devicesSync }, { name: QUEUE.devicesMaintenance }),
  ],
  providers: [
    ...core,
    DevicesSyncService,
    DevicesSyncProcessor,
    DevicesMaintenanceProcessor,
    DevicesSchedules,
  ],
})
export class DevicesWorkerModule {}
