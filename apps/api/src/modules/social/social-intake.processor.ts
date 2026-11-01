import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import type { z } from 'zod';

import { QUEUE } from '../../queues';
import { IDENTITY_ACCOUNT_CONFIRMED, IdentityAccountConfirmed } from '../identity';
import { TRACK_ACTIVITY_READY, TrackActivityReady } from '../tracks';
import { AutoAttendanceIntake, type AutoAttendanceOutcome } from './auto-attendance-intake';
import { InviteIntake, type InviteIntakeOutcome } from './invite-intake';

type IntakeOutcome = InviteIntakeOutcome | AutoAttendanceOutcome | 'skipped';

interface IntakeHandler<S extends z.ZodType> {
  schema: S;
  handle: (event: z.infer<S>) => Promise<IntakeOutcome>;
}

/**
 * Очередь `social-intake` (ADR-0027 п. 5): события других модулей по `socialOutboxRoutes` — приглашения (P6),
 * автоявка (P5); имя задачи = тип, jobId = id события outbox (идемпотентность — состояние связи и явки). Таблица
 * `тип → { схема, обработчик }` — новые типы в конец. Неизвестное имя — бросок; payload не по схеме — `skipped` с
 * логом. Отказ — ретраи публикатора, затем failed-набор (RC-P6-10). Логи — id события и итог, без кода приглашения.
 */
@Processor(QUEUE.socialIntake)
export class SocialIntakeProcessor extends WorkerHost {
  private readonly logger = new Logger(SocialIntakeProcessor.name);
  private readonly handlers: Record<string, IntakeHandler<z.ZodType>>;

  constructor(
    invites: InviteIntake,
    autoAttendance: AutoAttendanceIntake,
    private readonly outbox: MongoOutboxReader,
  ) {
    super();
    this.handlers = {
      [IDENTITY_ACCOUNT_CONFIRMED]: handler(IdentityAccountConfirmed, (event) =>
        invites.handle(event),
      ),
      [TRACK_ACTIVITY_READY]: handler(TrackActivityReady, (event) => autoAttendance.handle(event)),
    };
  }

  async process(job: Job): Promise<IntakeOutcome> {
    const entry = Object.hasOwn(this.handlers, job.name) ? this.handlers[job.name] : undefined;
    if (!entry) throw new Error(`unknown job ${job.name} in queue ${QUEUE.socialIntake}`);
    const { outboxEventId } = job.data as OutboxJobData;
    const event = entry.schema.safeParse(await this.outbox.payloadOf(outboxEventId));
    if (!event.success) {
      this.logger.warn(`social.event_skipped type=${job.name} event=${outboxEventId}`);
      return 'skipped';
    }
    try {
      const outcome = await entry.handle(event.data);
      this.logger.log(`social.intake type=${job.name} event=${outboxEventId} outcome=${outcome}`);
      return outcome;
    } catch (error) {
      this.logger.warn(`social.intake_failed type=${job.name} event=${outboxEventId}`);
      throw error;
    }
  }
}

function handler<S extends z.ZodType>(
  schema: S,
  handle: (event: z.infer<S>) => Promise<IntakeOutcome>,
): IntakeHandler<z.ZodType> {
  return { schema, handle: handle as IntakeHandler<z.ZodType>['handle'] };
}
