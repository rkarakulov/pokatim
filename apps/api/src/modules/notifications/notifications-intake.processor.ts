import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { type Env, pushChannelEnabled } from '../../config/env';
import { QUEUE } from '../../queues';
import { IdentityAccounts } from '../identity';
import { DeliveryJobs } from './delivery-jobs';
import { isEventStale } from './event-time';
import { type NoticeDraft, NotificationIntake } from './notification-intake';
import { renderNotification } from './notification-texts';
import type { NotificationDoc } from './notifications.collection';
import { isNotificationSourceEvent } from './notifications.events';
import { groupOf, initialDelivery, NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';

export type IntakeOutcome = 'written' | 'unchanged' | 'stale' | 'skipped';

/** Получатели пишутся пачками: настройки и живость — один запрос на пачку. */
const RECIPIENTS_BATCH = 500;
const DAY_MS = 86_400_000;

/**
 * Приём событий для уведомлений (`notifications-intake`, ADR-0017; имя задачи = тип события, jobId = id события
 * outbox): событие старше 72 ч — skip (RC-6) → черновики через порты источников (`NotificationIntake`) → живые
 * получатели (`IdentityAccounts.liveUserIds`, RC-4) → настройки пачкой → запись (`writeNotices`: уникальный
 * `(sourceEventId, userId)`, схлопывание по `collapseKey`). Повтор задачи и повторная публикация не создают дублей.
 * Текст — снимок на момент приёма, `createdAt` — `CLOCK` приёма (не время события). Затем — задачи доставки по
 * уведомлениям события в `pending` (`DeliveryJobs.scheduleEvent`, детерминированные jobId).
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

  async process(job: Job<OutboxJobData>): Promise<IntakeOutcome> {
    const type = job.name;
    if (!isNotificationSourceEvent(type)) {
      throw new Error(`unknown job ${type} in queue ${QUEUE.notificationsIntake}`);
    }
    const eventId = job.data.outboxEventId;
    const now = this.clock.now();
    if (isEventStale(eventId, now)) {
      this.logger.log(`notifications.event_stale type=${type} event=${eventId}`);
      return 'stale';
    }
    const drafts = await this.intake.drafts(type, await this.outbox.payloadOf(eventId));
    if (typeof drafts === 'string') {
      this.logger.log(`notifications.event_skipped type=${type} event=${eventId} reason=${drafts}`);
      return 'skipped';
    }
    let written = 0;
    for (const draft of drafts) written += await this.writeDraft(eventId, draft, now);
    // доставка — по уведомлениям события в `pending` (и при повторе задачи: те же jobId, запись могла пройти до сбоя)
    const scheduled = await this.jobs.scheduleEvent(eventId);
    this.logger.log(
      `notifications.intake type=${type} event=${eventId} written=${written} scheduled=${scheduled}`,
    );
    return written > 0 ? 'written' : 'unchanged';
  }

  private async writeDraft(eventId: string, draft: NoticeDraft, now: Date): Promise<number> {
    const { title, body } = renderNotification(draft.text);
    const kind = draft.text.kind;
    const recipients = [...new Set(draft.recipients)];
    let written = 0;
    for (let start = 0; start < recipients.length; start += RECIPIENTS_BATCH) {
      const live = await this.identity.liveUserIds(
        recipients.slice(start, start + RECIPIENTS_BATCH),
      );
      const userIds = [...live];
      const settings = await this.repository.findSettingsMany(userIds);
      const docs = userIds.map((userId): NotificationDoc => {
        const delivery = initialDelivery(
          kind,
          settings.get(userId) ?? DEFAULT_NOTIFICATION_SETTINGS,
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
          target: draft.target,
          sourceEventId: eventId,
          ...(draft.collapseKey === undefined ? {} : { collapseKey: draft.collapseKey }),
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
