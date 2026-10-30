import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { CLOCK, type Clock, ENV } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { type Env, pushChannelEnabled } from '../../config/env';
import { QUEUE } from '../../queues';
import { IdentityAccounts } from '../identity';
import { DeliveryJobs } from './delivery-jobs';
import { isEventStale } from './event-time';
import { FanoutJobs } from './fanout-jobs';
import {
  type FanoutChunk,
  planFanout,
  type RenderedDraft,
  renderDraft,
} from './notification-fanout';
import { NotificationIntake } from './notification-intake';
import type { NotificationDoc } from './notifications.collection';
import {
  FanoutJobData,
  IntakeJobData,
  isNotificationSourceEvent,
  NOTIFICATIONS_FANOUT_JOB,
} from './notifications.events';
import {
  DEFAULT_DELIVERY_SETTINGS,
  groupOf,
  initialDelivery,
  NOTIFICATIONS_POLICY,
} from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';

export type IntakeOutcome = 'written' | 'unchanged' | 'stale' | 'skipped' | 'fanned_out';

/** Получатели пишутся пачками: настройки и живость — один запрос на пачку. */
const RECIPIENTS_BATCH = 500;
const DAY_MS = 86_400_000;

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * Приём событий для уведомлений (`notifications-intake`, ADR-0017; имя задачи = тип события, jobId = id события
 * outbox): событие старше 72 ч — skip (RC-6) → черновики через порты источников (`NotificationIntake`) → живые
 * получатели (`IdentityAccounts.liveUserIds`, RC-4) → настройки пачкой → запись (`writeNotices`: уникальный
 * `(sourceEventId, userId)`, схлопывание по `collapseKey`). Повтор задачи и повторная публикация не создают дублей.
 * Текст — снимок на момент приёма, `createdAt` — `CLOCK` приёма (не время события). Затем — задачи доставки по
 * уведомлениям события в `pending` (`DeliveryJobs.scheduleEvent`, детерминированные jobId).
 *
 * Аудитория больше `fanoutChunk` — раскладка на задачи-пачки `notifications.fanout` той же очереди (`planFanout`):
 * план сохраняется в данных задачи intake (`job.updateData`) до постановки, затем `FanoutJobs.enqueue` ставит пачки и
 * проверяет каждую. Повтор intake с планом в данных порты не зовёт (состав зафиксирован) и дотягивает недоставленные
 * пачки. Intake сам не пишет, пачка пишет и доставляет только своих получателей.
 */
@Processor(QUEUE.notificationsIntake, { concurrency: 4 })
export class NotificationsIntakeProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsIntakeProcessor.name);

  constructor(
    private readonly outbox: MongoOutboxReader,
    private readonly intake: NotificationIntake,
    private readonly identity: IdentityAccounts,
    private readonly repository: NotificationsRepository,
    private readonly jobs: DeliveryJobs,
    private readonly fanout: FanoutJobs,
    @Inject(ENV)
    private readonly env: Pick<
      Env,
      | 'PUSH_ENABLED'
      | 'WEB_PUSH_ENABLED'
      | 'VAPID_PUBLIC_KEY'
      | 'VAPID_PRIVATE_KEY'
      | 'VAPID_SUBJECT'
    >,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job): Promise<IntakeOutcome> {
    if (job.name === NOTIFICATIONS_FANOUT_JOB) return this.processChunk(job);
    const type = job.name;
    if (!isNotificationSourceEvent(type)) {
      throw new Error(`unknown job ${type} in queue ${QUEUE.notificationsIntake}`);
    }
    const data = IntakeJobData.parse(job.data);
    const eventId = data.outboxEventId;
    const now = this.clock.now();
    if (isEventStale(eventId, now)) {
      this.logger.log(`notifications.event_stale type=${type} event=${eventId}`);
      return 'stale';
    }
    if (data.fanout) return this.enqueueFanout(type, eventId, data.fanout, true);
    const drafts = await this.intake.drafts(type, await this.outbox.payloadOf(eventId), now);
    if (typeof drafts === 'string') {
      this.logger.log(`notifications.event_skipped type=${type} event=${eventId} reason=${drafts}`);
      return 'skipped';
    }
    const chunks = planFanout(eventId, type, drafts, NOTIFICATIONS_POLICY.fanoutChunk);
    if (chunks) {
      // план — в данные задачи до постановки: повтор (сбой постановки, ретрай) ставит по нему, порты не зовёт
      const planned: IntakeJobData = { ...data, fanout: chunks };
      await job.updateData(planned);
      return this.enqueueFanout(type, eventId, chunks, false);
    }
    let written = 0;
    for (const draft of drafts) {
      written += await this.writeRecipients(eventId, renderDraft(draft), draft.recipients, now);
    }
    // доставка — по уведомлениям события в `pending` (и при повторе задачи: те же jobId, запись могла пройти до сбоя)
    const scheduled = await this.jobs.scheduleEvent(eventId);
    this.logger.log(
      `notifications.intake type=${type} event=${eventId} written=${written} scheduled=${scheduled}`,
    );
    return written > 0 ? 'written' : 'unchanged';
  }

  private async enqueueFanout(
    type: string,
    eventId: string,
    chunks: FanoutChunk[],
    repeat: boolean,
  ): Promise<IntakeOutcome> {
    await this.fanout.enqueue(chunks);
    const recipients = chunks.reduce((sum, chunk) => sum + chunk.data.userIds.length, 0);
    this.logger.log(
      `notifications.fanout type=${type} event=${eventId} chunks=${chunks.length} recipients=${recipients} repeat=${repeat}`,
    );
    return 'fanned_out';
  }

  /**
   * Пачка получателей: та же отсечка 72 ч по id события (застрявшая в ретраях задача не будит вчерашним событием,
   * RC-6), запись — общая `writeRecipients`, доставка — только по получателям пачки. Последняя попытка — лог
   * `notifications.fanout_failed` (без `userId`) и ошибка дальше (failed-набор BullMQ).
   */
  private async processChunk(job: Job): Promise<IntakeOutcome> {
    let event = '-';
    try {
      const data = FanoutJobData.parse(job.data);
      const { eventId, type, userIds } = data;
      event = eventId;
      const now = this.clock.now();
      if (isEventStale(eventId, now)) {
        this.logger.log(`notifications.fanout_stale type=${type} event=${eventId} job=${job.id}`);
        return 'stale';
      }
      const rendered: RenderedDraft = {
        kind: data.kind,
        title: data.title,
        body: data.body,
        target: data.target,
        ...(data.targets === undefined ? {} : { targets: new Map(Object.entries(data.targets)) }),
        ...(data.collapse === undefined ? {} : { collapse: data.collapse }),
      };
      const written = await this.writeRecipients(eventId, rendered, userIds, now);
      const scheduled = await this.jobs.scheduleEvent(eventId, userIds);
      this.logger.log(
        `notifications.fanout_chunk type=${type} event=${eventId} job=${job.id} written=${written} scheduled=${scheduled}`,
      );
      return written > 0 ? 'written' : 'unchanged';
    } catch (error) {
      if (isFinal(job)) {
        this.logger.error(
          `notifications.fanout_failed event=${event} job=${job.id} attempts=${job.attemptsMade + 1}`,
        );
      }
      throw error;
    }
  }

  /** Запись уведомлений получателям (прямой путь и пачка): живые → настройки пачкой → `writeNotices`. */
  private async writeRecipients(
    eventId: string,
    rendered: RenderedDraft,
    recipients: readonly string[],
    now: Date,
  ): Promise<number> {
    const { kind, title, body } = rendered;
    const unique = [...new Set(recipients)];
    let written = 0;
    for (let start = 0; start < unique.length; start += RECIPIENTS_BATCH) {
      const live = await this.identity.liveUserIds(unique.slice(start, start + RECIPIENTS_BATCH));
      const userIds = [...live];
      const settings = await this.repository.findSettingsMany(userIds);
      const docs = userIds.map((userId): NotificationDoc => {
        const delivery = initialDelivery(
          kind,
          settings.get(userId) ?? DEFAULT_DELIVERY_SETTINGS,
          now,
          pushChannelEnabled(this.env),
        );
        return {
          _id: uuidv7(),
          userId,
          kind,
          group: groupOf(kind),
          title,
          body,
          target: rendered.targets?.get(userId) ?? rendered.target,
          sourceEventId: eventId,
          ...(rendered.collapse === undefined
            ? {}
            : {
                collapseKey: rendered.collapse.key,
                ...(rendered.collapse.seq === undefined
                  ? {}
                  : { collapseSeq: rendered.collapse.seq }),
              }),
          createdAt: now,
          readAt: null,
          expireAt: new Date(now.getTime() + NOTIFICATIONS_POLICY.ttlDays * DAY_MS),
          ...delivery,
        };
      });
      written += await this.repository.writeNotices(docs);
    }
    return written;
  }
}
