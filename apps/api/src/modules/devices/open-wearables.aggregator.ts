import { Logger } from '@nestjs/common';
import type { DeviceProvider } from '@pokatim/contracts';
import { type Clock } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { verifySvixSignature } from './svix-signature';
import {
  AggregatorError,
  type AggregatorConnection,
  type AggregatorProvider,
  type AggregatorTrackPoint,
  type AggregatorWebhookEvent,
  type AggregatorWindow,
  type AggregatorWorkout,
  TrackTooLongError,
  type WearablesAggregator,
  WebhookSignatureError,
} from './wearables-aggregator';

/** Заголовок ключа Open Wearables (не Bearer). Значение ключа в логи и ошибки не попадает. */
export const OW_API_KEY_HEADER = 'X-Open-Wearables-API-Key';

export interface OpenWearablesConfig {
  /** Адрес API OW из env (`OW_API_URL`) — единственный хост исходящих запросов. */
  apiUrl: string;
  apiKey: string;
  /** `whsec_…`; нет — вебхук выключен. */
  webhookSecret: string | null;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export const OW_LIMITS = {
  timeoutMs: 15_000,
  maxBodyBytes: 5 * 1024 * 1024,
  /** Страниц тренировок за один `listWorkouts` (защита от бесконечной пагинации). */
  maxWorkoutPages: 50,
  workoutsPageSize: 100,
  timeseriesPageSize: 1000,
} as const;

/** Типы рядов трека: только координаты и высота — пульс и мощность не запрашиваются (R9). */
const TRACK_SERIES = ['latitude', 'longitude', 'elevation'] as const;

const IsoDate = z.iso.datetime({ offset: true, local: true });
const toDate = (value: string) =>
  new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
const Cursor = z.string().max(2048).nullish();

const ProvidersResponse = z
  .array(
    z.object({
      provider: z.string().min(1).max(40),
      name: z.string().max(80),
      is_enabled: z.boolean(),
      live_sync_mode: z.enum(['pull', 'webhook']).nullish(),
    }),
  )
  .max(100);
const UserResponse = z.object({ id: z.uuid() });
const UsersPage = z.object({ items: z.array(z.object({ id: z.uuid() })).max(100) });
const AuthorizeResponse = z.object({ authorization_url: z.url({ protocol: /^https$/ }).max(4096) });
const ConnectionsResponse = z
  .array(z.object({ provider: z.string().max(40), status: z.string().max(20) }))
  .max(100);
const Pagination = z.object({ next_cursor: Cursor, has_more: z.boolean() });
const WorkoutItem = z.object({
  id: z.uuid(),
  type: z.string().max(60).nullish(),
  start_time: IsoDate,
  end_time: IsoDate.nullish(),
  duration_seconds: z.number().nonnegative().nullish(),
  source: z.object({ provider: z.string().max(40).nullish() }).nullish(),
  avg_heart_rate_bpm: z.number().nullish(),
  average_watts: z.number().nullish(),
});
const WorkoutsPage = z.object({
  data: z.array(z.unknown()).max(1000),
  pagination: Pagination,
});
const SeriesSample = z.object({
  timestamp: IsoDate,
  type: z.string().max(60),
  value: z.number(),
});
const TimeseriesPage = z.object({
  data: z.array(SeriesSample).max(OW_LIMITS.timeseriesPageSize),
  pagination: Pagination,
});
const WebhookBody = z.object({
  type: z.string().max(100),
  data: z.object({ user_id: z.string().max(64).nullish() }).nullish(),
});

const CONNECTION_STATUSES = new Set(['active', 'expired', 'revoked']);

type Query = [string, string][];

/** `YYYY-MM-DD` (UTC): даты окна тренировок как в эталоне — дата конца OW покрывает весь день. */
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Адаптер Open Wearables 0.9 — единственное место, знающее REST OW (§5.1). Все запросы — только к `OW_API_URL`
 * (адрес не из данных), `redirect: 'manual'` (любой 3xx — ошибка), таймаут 15 с, тело ответа ≤ 5 МБ (потоковый
 * счётчик), ответы — zod (нужные поля строго, лишние игнорируются). Ошибки классифицируются `AggregatorError`:
 * 401/403 — `auth` (без повторов, лог `ow.auth_failed`), 404 — `not_found`, 429/5xx/сеть/таймаут — `unavailable`
 * (повтор). Логи — метод, шаблон пути и статус: без ключа, тел и id пользователей OW.
 */
export class OpenWearablesAggregator implements WearablesAggregator {
  private readonly logger = new Logger(OpenWearablesAggregator.name);
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;

  constructor(
    private readonly config: OpenWearablesConfig,
    private readonly clock: Clock,
  ) {
    this.base = `${config.apiUrl.replace(/\/+$/, '')}/api/v1`;
    this.timeoutMs = config.timeoutMs ?? OW_LIMITS.timeoutMs;
    this.maxBodyBytes = config.maxBodyBytes ?? OW_LIMITS.maxBodyBytes;
  }

  async listProviders(): Promise<AggregatorProvider[]> {
    const rows = await this.request('GET', '/oauth/providers', [], ProvidersResponse);
    return rows.map((row) => ({
      provider: row.provider,
      name: row.name,
      enabled: row.is_enabled,
      liveSync: row.live_sync_mode ?? null,
    }));
  }

  /**
   * `POST /users { external_user_id }` (без имени и e-mail). `external_user_id` в OW уникален: повтор после сбоя
   * (OW отвечает 400 — `IntegrityError`, или 409) — поиск `GET /users?external_user_id=` (точное совпадение).
   */
  async ensureUser(externalId: string): Promise<string> {
    try {
      const user = await this.request('POST', '/users', [], UserResponse, {
        external_user_id: externalId,
      });
      return user.id;
    } catch (error) {
      if (!(error instanceof AggregatorError) || error.kind !== 'rejected') throw error;
      const page = await this.request(
        'GET',
        '/users',
        [
          ['external_user_id', externalId],
          ['limit', '2'],
        ],
        UsersPage,
      );
      const [found] = page.items;
      if (!found || page.items.length > 1) throw error;
      return found.id;
    }
  }

  async createAuthorization(input: {
    aggUserId: string;
    provider: DeviceProvider;
    redirectUri: string;
  }): Promise<{ authorizeUrl: string }> {
    const response = await this.request(
      'GET',
      `/oauth/${input.provider}/authorize`,
      [
        ['user_id', input.aggUserId],
        ['redirect_uri', input.redirectUri],
      ],
      AuthorizeResponse,
    );
    return { authorizeUrl: response.authorization_url };
  }

  async listConnections(aggUserId: string): Promise<AggregatorConnection[]> {
    const rows = await this.request(
      'GET',
      `/users/${this.userPath(aggUserId)}/connections`,
      [],
      ConnectionsResponse,
    );
    return rows.map((row) => ({
      provider: row.provider,
      // незнакомый статус — как истёкший: импорт не идёт, экран предложит подключить снова
      status: CONNECTION_STATUSES.has(row.status)
        ? (row.status as AggregatorConnection['status'])
        : 'expired',
    }));
  }

  async revokeConnection(aggUserId: string, provider: DeviceProvider): Promise<void> {
    try {
      await this.request(
        'DELETE',
        `/users/${this.userPath(aggUserId)}/connections/${provider}`,
        [],
        null,
      );
    } catch (error) {
      if (error instanceof AggregatorError && error.kind === 'not_found') return;
      throw error;
    }
  }

  async requestHistoricalSync(
    aggUserId: string,
    provider: DeviceProvider,
    days: number,
  ): Promise<boolean> {
    try {
      await this.request(
        'POST',
        `/providers/${provider}/users/${this.userPath(aggUserId)}/sync/historical`,
        [['days', String(Math.max(1, Math.trunc(days)))]],
        null,
      );
      return true;
    } catch (error) {
      // 400 — провайдер не поддерживает историческую выгрузку
      if (error instanceof AggregatorError && error.kind === 'rejected') return false;
      throw error;
    }
  }

  async requestSync(aggUserId: string, provider: DeviceProvider): Promise<void> {
    await this.request(
      'POST',
      `/providers/${provider}/users/${this.userPath(aggUserId)}/sync`,
      [['data_type', 'workouts']],
      null,
    );
  }

  async *listWorkouts(
    aggUserId: string,
    window: AggregatorWindow,
  ): AsyncIterable<AggregatorWorkout> {
    let cursor: string | null = null;
    for (let page = 0; page < OW_LIMITS.maxWorkoutPages; page += 1) {
      const query: Query = [
        ['start_date', dateOnly(window.from)],
        ['end_date', dateOnly(window.to)],
        ['limit', String(OW_LIMITS.workoutsPageSize)],
      ];
      if (cursor) query.push(['cursor', cursor]);
      const response = await this.request(
        'GET',
        `/users/${this.userPath(aggUserId)}/events/workouts`,
        query,
        WorkoutsPage,
      );
      let skipped = 0;
      for (const raw of response.data) {
        const item = WorkoutItem.safeParse(raw);
        if (!item.success) {
          skipped += 1;
          continue;
        }
        yield toWorkout(item.data);
      }
      if (skipped > 0) this.logger.warn(`ow.workouts_skipped count=${skipped}`);
      cursor = response.pagination.has_more ? (response.pagination.next_cursor ?? null) : null;
      if (!cursor) return;
    }
    this.logger.warn(`ow.workouts_pages_capped pages=${OW_LIMITS.maxWorkoutPages}`);
  }

  /**
   * `/timeseries` (`types` — повторяемый параметр, `resolution=raw`, курсор): ряды трека тренировки этого
   * провайдера. Широта и долгота — только пары с одинаковой меткой времени (как в эталоне), высота — по той же
   * метке; без децимации. Сэмплов больше, чем помещается в `maxPoints` точек трёх рядов, — `TrackTooLongError`.
   */
  async fetchWorkoutTrack(
    aggUserId: string,
    provider: DeviceProvider,
    window: AggregatorWindow,
    maxPoints: number,
  ): Promise<AggregatorTrackPoint[]> {
    const series: Record<(typeof TRACK_SERIES)[number], Map<number, number>> = {
      latitude: new Map(),
      longitude: new Map(),
      elevation: new Map(),
    };
    const maxSamples = maxPoints * TRACK_SERIES.length;
    const maxPages = Math.ceil(maxSamples / OW_LIMITS.timeseriesPageSize) + 1;
    let samples = 0;
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const query: Query = [
        ...TRACK_SERIES.map((type): [string, string] => ['types', type]),
        ['start_time', window.from.toISOString()],
        ['end_time', window.to.toISOString()],
        ['resolution', 'raw'],
        ['provider', provider],
        ['limit', String(OW_LIMITS.timeseriesPageSize)],
      ];
      if (cursor) query.push(['cursor', cursor]);
      const response = await this.request(
        'GET',
        `/users/${this.userPath(aggUserId)}/timeseries`,
        query,
        TimeseriesPage,
      );
      for (const sample of response.data) {
        if (!(TRACK_SERIES as readonly string[]).includes(sample.type)) continue;
        const time = toDate(sample.timestamp).getTime();
        if (!Number.isFinite(time) || !Number.isFinite(sample.value)) continue;
        series[sample.type as (typeof TRACK_SERIES)[number]].set(time, sample.value);
      }
      samples += response.data.length;
      if (samples > maxSamples || series.latitude.size > maxPoints) throw new TrackTooLongError();
      cursor = response.pagination.has_more ? (response.pagination.next_cursor ?? null) : null;
      if (!cursor) break;
      if (page === maxPages - 1) throw new TrackTooLongError();
    }

    const points: AggregatorTrackPoint[] = [];
    for (const [time, lat] of series.latitude) {
      const lon = series.longitude.get(time);
      if (lon === undefined) continue;
      points.push([time, lat, lon, series.elevation.get(time) ?? null]);
    }
    points.sort((a, b) => a[0] - b[0]);
    if (points.length > maxPoints) throw new TrackTooLongError();
    return points;
  }

  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): AggregatorWebhookEvent {
    if (!this.config.webhookSecret) throw new WebhookSignatureError('webhook disabled');
    verifySvixSignature(this.config.webhookSecret, headers, rawBody, this.clock.now());
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('invalid body');
    }
    const body = WebhookBody.safeParse(json);
    if (!body.success) return { aggUserId: null, type: 'unknown' };
    const userId = body.data.data?.user_id ?? null;
    return {
      aggUserId: userId && z.uuid().safeParse(userId).success ? userId : null,
      type: body.data.type,
    };
  }

  // --- HTTP ---

  /** id пользователя OW в пути — только UUID (значение из нашей БД, но путь собирается строго). */
  private userPath(aggUserId: string): string {
    if (!z.uuid().safeParse(aggUserId).success) {
      throw new AggregatorError('protocol', null, 'invalid aggregator user id');
    }
    return aggUserId;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    query: Query,
    schema: z.ZodType<T> | null,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const route = `${method} ${templatePath(path)}`;
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of query) url.searchParams.append(key, value);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          accept: 'application/json',
          [OW_API_KEY_HEADER]: this.config.apiKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
      this.logger.warn(`ow.unavailable ${route} reason=${reason}`);
      throw new AggregatorError('unavailable', null, `aggregator ${reason}`);
    }

    const { status } = response;
    if (status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      throw this.statusError(route, status);
    }
    const text = await this.readLimited(response, route);
    if (!schema) return undefined as T;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AggregatorError('protocol', status, 'aggregator response is not JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(`ow.bad_response ${route}`);
      throw new AggregatorError('protocol', status, 'aggregator response does not match schema');
    }
    return parsed.data;
  }

  private statusError(route: string, status: number): AggregatorError {
    if (status < 400) {
      this.logger.warn(`ow.redirect ${route} status=${status}`);
      return new AggregatorError('protocol', status, 'aggregator redirect is not followed');
    }
    if (status === 401 || status === 403) {
      this.logger.error(`ow.auth_failed ${route} status=${status}`);
      return new AggregatorError('auth', status, 'aggregator rejected the API key');
    }
    if (status === 404) return new AggregatorError('not_found', status, 'aggregator: not found');
    if (status === 429 || status >= 500) {
      this.logger.warn(`ow.unavailable ${route} status=${status}`);
      return new AggregatorError('unavailable', status, 'aggregator temporarily unavailable');
    }
    this.logger.warn(`ow.rejected ${route} status=${status}`);
    return new AggregatorError('rejected', status, 'aggregator rejected the request');
  }

  /** Тело ответа с обрывом на лимите (потоковый счётчик, без `content-length` на веру). */
  private async readLimited(response: Response, route: string): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBodyBytes) {
          await reader.cancel().catch(() => undefined);
          this.logger.warn(`ow.body_too_large ${route}`);
          throw new AggregatorError('protocol', response.status, 'aggregator response too large');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AggregatorError) throw error;
      throw new AggregatorError('unavailable', response.status, 'aggregator response aborted');
    }
    return Buffer.concat(chunks, size).toString('utf8');
  }
}

/** Путь без идентификаторов — для логов (`/users/{id}/connections`). */
function templatePath(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}');
}

function toWorkout(item: z.infer<typeof WorkoutItem>): AggregatorWorkout {
  return {
    id: item.id,
    provider: item.source?.provider?.toLowerCase() ?? null,
    type: (item.type ?? 'unknown').toLowerCase(),
    startedAt: toDate(item.start_time),
    endedAt: item.end_time ? toDate(item.end_time) : null,
    durationSec: item.duration_seconds ?? null,
    hasHeartRate: item.avg_heart_rate_bpm !== null && item.avg_heart_rate_bpm !== undefined,
    hasPower: item.average_watts !== null && item.average_watts !== undefined,
  };
}
