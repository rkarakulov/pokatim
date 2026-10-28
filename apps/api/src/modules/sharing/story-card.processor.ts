import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { isDomainError } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { RESULTS_FOR_SHARING, type ResultsForSharing } from '../results';
import { RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import { RideInviteInputs } from './ride-invite.inputs';
import { renderRideInvite } from './ride-invite.png';
import {
  RIDE_INVITE_RENDER_JOB,
  RideInviteJob,
  STORY_CARD_RENDER_JOB,
  StoryCardCache,
  StoryCardJob,
} from './story-card.cache';
import { StoryCardInputs } from './story-card.inputs';
import { renderStoryCard } from './story-card.png';

export type StoryCardOutcome = 'ready' | 'failed' | 'skipped';

/** Предел сообщения ошибки рендера в логе, символов. */
const LOG_MESSAGE_MAX = 200;
const clip = (message: string) =>
  message.length > LOG_MESSAGE_MAX ? `${message.slice(0, LOG_MESSAGE_MAX)}…` : message;

interface BuildOptions {
  finalAttempt?: boolean;
}

/**
 * Причина провала в логе: тип и начало сообщения — диагностика (шрифт, размер PNG, resvg). Сообщение satori/resvg
 * может цитировать разметку: у сторис это имя с согласием и название гонки (принято, ADR-0018) — только первые
 * `LOG_MESSAGE_MAX` символов; у приглашения — название и место райда, которых в логах быть не должно, — только тип.
 */
type ReasonDetail = 'clipped' | 'name-only';

/**
 * Рендер карточек очереди `story-card` (ADR-0018): сторис своего результата (`story-card.render`) и приглашение
 * кофе-райда (`ride-invite.render`). Входы перечитываются и сверяются с хэшем задачи (изменились — `skipped`, PNG не
 * пишется) → линия (порт `results`: отрезок между воротами или маршрут; порт `rides`: маршрут каталога) → satori +
 * resvg → PNG в Redis под новым токеном. Сбой — ретрай; на последней попытке — видимый `failed`. Лог — заявка или
 * райд, шаблон, итог, байты и время, без `userId`, имени, названия и токена.
 */
@Processor(QUEUE.storyCard, { concurrency: 1 })
export class StoryCardProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryCardProcessor.name);

  constructor(
    private readonly cache: StoryCardCache,
    private readonly inputs: StoryCardInputs,
    private readonly invites: RideInviteInputs,
    @Inject(RESULTS_FOR_SHARING) private readonly results: ResultsForSharing,
    @Inject(RIDES_FOR_SHARING) private readonly rides: RidesForSharing,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<StoryCardOutcome> {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const schema =
      job.name === STORY_CARD_RENDER_JOB
        ? StoryCardJob
        : job.name === RIDE_INVITE_RENDER_JOB
          ? RideInviteJob
          : null;
    if (!schema) throw new Error(`unknown job ${job.name} in queue ${QUEUE.storyCard}`);
    const data = schema.safeParse(job.data);
    if (!data.success) {
      this.logger.warn(`job ${job.id}: no valid data, skipped`);
      return 'skipped';
    }
    return 'raceId' in data.data
      ? this.build(data.data, { finalAttempt })
      : this.buildRideInvite(data.data as RideInviteJob, { finalAttempt });
  }

  /** Рендер сторис своего результата — вызывается и тестами напрямую. */
  build(job: StoryCardJob, options: BuildOptions = {}): Promise<StoryCardOutcome> {
    let label = 'entry -';
    return this.run(
      job.hash,
      () => `${label} ${job.template}`,
      options,
      'clipped',
      async () => {
        const resolved = await this.inputs.resolve(job.userId, job.raceId, job.template);
        label = `entry ${resolved?.input.facts.entryId ?? '-'}`;
        if (!resolved || resolved.hash !== job.hash) return null;
        const line = await this.results.storyCardLine(job.userId, resolved.input.facts);
        return {
          png: await renderStoryCard(resolved.input, line?.line ?? null),
          note: line?.kind ?? 'no line',
        };
      },
    );
  }

  /**
   * Рендер приглашения кофе-райда — вызывается и тестами напрямую. Райд скрыт/удалён — 404 порта: тоже `skipped`
   * (картинка не нужна, ретраить нечего). Линия — только пока маршрут в каталоге (`inviteLine` перепроверяет).
   */
  buildRideInvite(job: RideInviteJob, options: BuildOptions = {}): Promise<StoryCardOutcome> {
    const label = () => `ride ${job.rideId} ${job.template}`;
    return this.run(job.hash, label, options, 'name-only', async () => {
      const resolved = await this.invites
        .resolve(job.userId, job.rideId, job.template)
        .catch((error: unknown) => {
          if (isNotFound(error)) return null;
          throw error;
        });
      if (!resolved || resolved.hash !== job.hash) return null;
      const routeId = resolved.input.facts.routeId;
      const line = routeId ? await this.rides.inviteLine(routeId) : null;
      return {
        png: await renderRideInvite(resolved.input, line),
        note: line ? 'route' : 'no line',
      };
    });
  }

  /** Общий исход задачи: `null` из рендера — `skipped`; ошибка — ретрай, на последней попытке — `failed`. */
  private async run(
    hash: string,
    label: () => string,
    { finalAttempt = false }: BuildOptions,
    detail: ReasonDetail,
    render: () => Promise<{ png: Buffer; note: string } | null>,
  ): Promise<StoryCardOutcome> {
    const started = Date.now();
    try {
      const result = await render();
      if (!result) {
        await this.cache.release(hash);
        this.logger.log(`${label()}: skipped`);
        return 'skipped';
      }
      await this.cache.storeReady(hash, result.png);
      this.logger.log(
        `${label()}: ready (${result.note}) ${result.png.byteLength} B in ${Date.now() - started} ms`,
      );
      return 'ready';
    } catch (error) {
      if (!finalAttempt) throw error;
      await this.cache.storeFailed(hash);
      const reason =
        error instanceof Error
          ? detail === 'clipped'
            ? `${error.name}: ${clip(error.message)}`
            : error.name
          : 'unknown';
      this.logger.warn(`${label()}: failed (${reason}) in ${Date.now() - started} ms`);
      return 'failed';
    }
  }
}

/** 404 домена (`domainError('NOT_FOUND', 404)` порта `rides`): райд скрыт или удалён. */
const isNotFound = (error: unknown) => isDomainError(error) && error.status === 404;
