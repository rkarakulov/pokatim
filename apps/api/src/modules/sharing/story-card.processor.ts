import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { CLOCK, type Clock, isDomainError } from '@rkarakulov/api-kit/core';
import type { LonLat } from '@pokatim/contracts';
import type { Job } from 'bullmq';
import type { z } from 'zod';

import { QUEUE } from '../../queues';
import { RESULTS_FOR_SHARING, type ResultsForSharing } from '../results';
import { RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import {
  ROUTE_GEOMETRY,
  type RouteGeometry,
  ROUTES_FOR_SHARING,
  type RoutesForSharing,
} from '../routes';
import { AchievementCardInputs } from './achievement-card.inputs';
import { renderAchievementCard } from './achievement-card.png';
import { OG_CARD_RENDER_JOB, OgCardCache, OgCardJob } from './og-card.cache';
import { type OgCardInput, OgCardInputs, ogLogId } from './og-card.inputs';
import { renderOgCard } from './og-card.png';
import { OG_CARD_POLICY, ogPrerenderable } from './sharing.policy';
import { RideInviteInputs } from './ride-invite.inputs';
import { renderRideInvite } from './ride-invite.png';
import {
  ACHIEVEMENT_CARD_RENDER_JOB,
  AchievementCardJob,
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

/** Разбор данных задачи своей схемой и рендер; данные не своей схемы — `invalid()` (`skipped`). */
type JobRoute = (
  data: unknown,
  options: BuildOptions,
  invalid: () => StoryCardOutcome,
) => Promise<StoryCardOutcome>;

/** Куда записать исход задачи: кэш сторис/приглашений (`StoryCardCache`) или OG-картинок (`OgCardCache`). */
interface OutcomeSink {
  release(hash: string): Promise<void>;
  storeReady(hash: string, png: Buffer): Promise<unknown>;
  storeFailed(hash: string): Promise<void>;
}

/**
 * Рендер карточек очереди `story-card` (ADR-0018): сторис своего результата (`story-card.render`), приглашение
 * кофе-райда (`ride-invite.render`), карточка достижения (`achievement-card.render`) и OG-картинка публичной страницы (`og-card.render`, og-images; диспетчер — по имени
 * задачи). Входы перечитываются и сверяются с хэшем задачи (изменились — `skipped`, PNG не
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
    private readonly achievementInputs: AchievementCardInputs,
    @Inject(RESULTS_FOR_SHARING) private readonly results: ResultsForSharing,
    @Inject(RIDES_FOR_SHARING) private readonly rides: RidesForSharing,
    private readonly ogCache: OgCardCache,
    private readonly ogInputs: OgCardInputs,
    @Inject(ROUTE_GEOMETRY) private readonly geometry: RouteGeometry,
    @Inject(ROUTES_FOR_SHARING) private readonly routes: RoutesForSharing,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<StoryCardOutcome> {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const route = this.routeOf(job.name);
    if (!route) throw new Error(`unknown job ${job.name} in queue ${QUEUE.storyCard}`);
    return route(job.data, { finalAttempt }, () => {
      this.logger.warn(`job ${job.id}: no valid data, skipped`);
      return 'skipped';
    });
  }

  /** Имя задачи → схема данных → метод рендера; незнакомое имя — `null`. */
  private routeOf(name: string): JobRoute | null {
    const parsed =
      <T>(
        schema: z.ZodType<T>,
        build: (data: T, options: BuildOptions) => Promise<StoryCardOutcome>,
      ): JobRoute =>
      async (data, options, invalid) => {
        const result = schema.safeParse(data);
        return result.success ? build(result.data, options) : invalid();
      };
    switch (name) {
      case STORY_CARD_RENDER_JOB:
        return parsed(StoryCardJob, (data, options) => this.build(data, options));
      case RIDE_INVITE_RENDER_JOB:
        return parsed(RideInviteJob, (data, options) => this.buildRideInvite(data, options));
      case ACHIEVEMENT_CARD_RENDER_JOB:
        return parsed(AchievementCardJob, (data, options) =>
          this.buildAchievementCard(data, options),
        );
      case OG_CARD_RENDER_JOB:
        return parsed(OgCardJob, (data, options) => this.buildOgCard(data, options));
      default:
        return null;
    }
  }

  /** Рендер сторис своего результата — вызывается и тестами напрямую. */
  build(job: StoryCardJob, options: BuildOptions = {}): Promise<StoryCardOutcome> {
    let label = 'entry -';
    return this.run(
      this.cache,
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
    return this.run(this.cache, job.hash, label, options, 'name-only', async () => {
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

  /**
   * Рендер карточки своего достижения — вызывается и тестами напрямую. Достижение больше не получено (факт пропал,
   * отозвано) или вход изменился — `skipped`. В логе — код и шаблон; причина провала — только тип (разметка содержит
   * название объекта и имя).
   */
  buildAchievementCard(
    job: AchievementCardJob,
    options: BuildOptions = {},
  ): Promise<StoryCardOutcome> {
    const label = () => `achievement ${job.code} ${job.template}`;
    return this.run(this.cache, job.hash, label, options, 'name-only', async () => {
      const resolved = await this.achievementInputs.resolve(job.userId, job.code, job.template);
      if (!resolved || resolved.hash !== job.hash) return null;
      return { png: await renderAchievementCard(resolved.input), note: 'badge' };
    });
  }

  /**
   * Рендер OG-картинки публичной страницы (og-images) — вызывается и тестами напрямую. Входы перечитываются (объект
   * больше не публичный или хэш устарел — `skipped`, PNG не пишется). Линия: гонка — линия показа маршрута коридора
   * (`ROUTE_GEOMETRY`, как на странице), райд — только маршрут каталога (`inviteLine`), маршрут — линия каталога.
   * Сезон и райдер — без линии. Провал на последней попытке — ключ постановки удерживается `failedHoldSec`. В логе —
   * вид и id, без названия; райдер — префикс хэша вместо `publicId`.
   */
  buildOgCard(job: OgCardJob, options: BuildOptions = {}): Promise<StoryCardOutcome> {
    const label = () => `og ${job.kind} ${ogLogId(job.kind, job.id, job.hash)}`;
    let ttlSec: number = OG_CARD_POLICY.pngTtlSec;
    const sink: OutcomeSink = {
      release: (hash) => this.ogCache.release(hash),
      storeReady: (hash, png) =>
        this.ogCache.storeReady({ kind: job.kind, id: job.id, hash }, png, ttlSec),
      storeFailed: (hash) => this.ogCache.holdFailed(hash),
    };
    return this.run(sink, job.hash, label, options, 'name-only', async () => {
      const resolved =
        job.kind === 'brand'
          ? this.ogInputs.resolveBrand()
          : await this.ogInputs.resolve(job.kind, job.id);
      if (!resolved || resolved.hash !== job.hash) return null;
      // вне окна пререндера (самолечение по запросу) — короткий TTL: обход старых объектов не копит PNG (ревью F2)
      ttlSec = ogPrerenderable(resolved.input, this.clock.now())
        ? OG_CARD_POLICY.pngTtlSec
        : OG_CARD_POLICY.pngShortTtlSec;
      const line = await this.ogLine(resolved.input);
      return { png: await renderOgCard(resolved.input, line), note: line ? 'line' : 'no line' };
    });
  }

  private async ogLine(input: OgCardInput): Promise<LonLat[] | null> {
    switch (input.kind) {
      case 'race':
        return input.facts.routeId
          ? ((await this.geometry.displayGeometry(input.facts.routeId))?.line ?? null)
          : null;
      case 'ride':
        return input.facts.routeId ? this.rides.inviteLine(input.facts.routeId) : null;
      case 'route':
        return this.routes.ogLine(input.facts.routeId);
      case 'calendar':
      case 'season':
      case 'rider':
      case 'brand':
        return null;
    }
  }

  /** Общий исход задачи: `null` из рендера — `skipped`; ошибка — ретрай, на последней попытке — `failed`. */
  private async run(
    sink: OutcomeSink,
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
        await sink.release(hash);
        this.logger.log(`${label()}: skipped`);
        return 'skipped';
      }
      await sink.storeReady(hash, result.png);
      this.logger.log(
        `${label()}: ready (${result.note}) ${result.png.byteLength} B in ${Date.now() - started} ms`,
      );
      return 'ready';
    } catch (error) {
      if (!finalAttempt) throw error;
      await sink.storeFailed(hash);
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
