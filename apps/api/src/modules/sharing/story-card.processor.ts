import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { RESULTS_FOR_SHARING, type ResultsForSharing } from '../results';
import { STORY_CARD_RENDER_JOB, StoryCardCache, StoryCardJob } from './story-card.cache';
import { StoryCardInputs } from './story-card.inputs';
import { renderStoryCard } from './story-card.png';

export type StoryCardOutcome = 'ready' | 'failed' | 'skipped';

/** Предел сообщения ошибки рендера в логе, символов. */
const LOG_MESSAGE_MAX = 200;
const clip = (message: string) =>
  message.length > LOG_MESSAGE_MAX ? `${message.slice(0, LOG_MESSAGE_MAX)}…` : message;

/**
 * Рендер карточки для сторис (`story-card`, story-cards): входы перечитываются и сверяются с хэшем задачи (место,
 * тема, имя сменились — `skipped`, PNG не пишется) → линия (порт `results`: отрезок между воротами или маршрут) →
 * satori + resvg → PNG в Redis под новым токеном. Сбой — ретрай; на последней попытке — видимый `failed`. Лог —
 * заявка, шаблон, итог, байты и время, без `userId`, имени и токена.
 */
@Processor(QUEUE.storyCard, { concurrency: 1 })
export class StoryCardProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryCardProcessor.name);

  constructor(
    private readonly cache: StoryCardCache,
    private readonly inputs: StoryCardInputs,
    @Inject(RESULTS_FOR_SHARING) private readonly results: ResultsForSharing,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<StoryCardOutcome> {
    if (job.name !== STORY_CARD_RENDER_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.storyCard}`);
    }
    const data = StoryCardJob.safeParse(job.data);
    if (!data.success) {
      this.logger.warn(`job ${job.id}: no valid data, skipped`);
      return 'skipped';
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.build(data.data, { finalAttempt });
  }

  /** Рендер одной задачи — вызывается и тестами напрямую. */
  async build(
    job: StoryCardJob,
    { finalAttempt = false }: { finalAttempt?: boolean } = {},
  ): Promise<StoryCardOutcome> {
    const started = Date.now();
    let entry = '-';
    try {
      const resolved = await this.inputs.resolve(job.userId, job.raceId, job.template);
      entry = resolved?.input.facts.entryId ?? '-';
      if (!resolved || resolved.hash !== job.hash) {
        await this.cache.release(job.hash);
        this.logger.log(`entry ${entry} ${job.template}: skipped`);
        return 'skipped';
      }
      const line = await this.results.storyCardLine(job.userId, resolved.input.facts);
      const png = await renderStoryCard(resolved.input, line?.line ?? null);
      await this.cache.storeReady(job.hash, png);
      this.logger.log(
        `entry ${entry} ${job.template}: ready (${line?.kind ?? 'no line'}) ${png.byteLength} B` +
          ` in ${Date.now() - started} ms`,
      );
      return 'ready';
    } catch (error) {
      if (!finalAttempt) throw error;
      await this.cache.storeFailed(job.hash);
      // тип и начало сообщения — диагностика (шрифт, размер PNG, resvg); сообщение satori/resvg может цитировать
      // разметку (название, имя с согласием) — в лог только первые `LOG_MESSAGE_MAX` символов
      const reason = error instanceof Error ? `${error.name}: ${clip(error.message)}` : 'unknown';
      this.logger.warn(
        `entry ${entry} ${job.template}: failed (${reason}) in ${Date.now() - started} ms`,
      );
      return 'failed';
    }
  }
}
