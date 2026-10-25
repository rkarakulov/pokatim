import type { DeviceProvider } from '@pokatim/contracts';

/**
 * Порт агрегатора устройств (ADR-0011, R6): доменные типы pokatim, а не формат агрегатора. Единственная реализация
 * сейчас — `OpenWearablesAggregator` (REST Open Wearables); замена агрегатора — новый адаптер за этим портом.
 */

/** Провайдер в каталоге агрегатора. */
export interface AggregatorProvider {
  provider: string;
  name: string;
  enabled: boolean;
  liveSync: 'webhook' | 'pull' | null;
}

export type AggregatorConnectionStatus = 'active' | 'expired' | 'revoked';

export interface AggregatorConnection {
  provider: string;
  status: AggregatorConnectionStatus;
}

/** Тренировка агрегатора: только сводка; пульс и мощность — факт наличия средних (R9), без значений. */
export interface AggregatorWorkout {
  id: string;
  /** Провайдер, с которого пришла тренировка (у OW — `source.provider`). */
  provider: string | null;
  type: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  hasHeartRate: boolean;
  hasPower: boolean;
}

export interface AggregatorWindow {
  from: Date;
  to: Date;
}

/** Точка трека: `[unix ms, lat, lon, ele | null]` — порядок `pokatim.stream.v1`. */
export type AggregatorTrackPoint = [number, number, number, number | null];

/** Проверенный вебхук: только адресат события; данные тела не используются (R5). */
export interface AggregatorWebhookEvent {
  aggUserId: string | null;
  type: string;
}

export interface WearablesAggregator {
  /** Пользователь агрегатора по внешнему id (`pokatim:<userId>`, без ПДн): создать или найти. */
  ensureUser(externalId: string): Promise<string>;
  createAuthorization(input: {
    aggUserId: string;
    provider: DeviceProvider;
    redirectUri: string;
  }): Promise<{ authorizeUrl: string }>;
  listConnections(aggUserId: string): Promise<AggregatorConnection[]>;
  /** Отзыв подключения (агрегатор отзывает у провайдера); подключения уже нет — успех. */
  revokeConnection(aggUserId: string, provider: DeviceProvider): Promise<void>;
  /** Историческая выгрузка; `false` — провайдер её не поддерживает. */
  requestHistoricalSync(
    aggUserId: string,
    provider: DeviceProvider,
    days: number,
  ): Promise<boolean>;
  /** Попросить агрегатор забрать новые данные у провайдера (pull-провайдеры). */
  requestSync(aggUserId: string, provider: DeviceProvider): Promise<void>;
  listWorkouts(aggUserId: string, window: AggregatorWindow): AsyncIterable<AggregatorWorkout>;
  /**
   * Трек тренировки без децимации: широта и долгота — пары с одинаковой меткой времени, высота — по той же метке
   * или `null`. Больше `maxPoints` точек — `TrackTooLongError`.
   */
  fetchWorkoutTrack(
    aggUserId: string,
    provider: DeviceProvider,
    window: AggregatorWindow,
    maxPoints: number,
  ): Promise<AggregatorTrackPoint[]>;
  /** Подпись вебхука; неверная — `WebhookSignatureError`. */
  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
  ): AggregatorWebhookEvent;
  listProviders(): Promise<AggregatorProvider[]>;
}

export const WEARABLES_AGGREGATOR = Symbol('WEARABLES_AGGREGATOR');

/**
 * Отказ агрегатора: `auth` — ключ отвергнут (без повторов), `not_found`, `rejected` — запрос отклонён (4xx),
 * `unavailable` — сеть, таймаут, 429, 5xx (повторяемо), `protocol` — редирект, лимит тела, ответ не по схеме,
 * `disabled` — агрегатор не настроен.
 */
export type AggregatorErrorKind =
  'auth' | 'not_found' | 'rejected' | 'unavailable' | 'protocol' | 'disabled';

export class AggregatorError extends Error {
  constructor(
    readonly kind: AggregatorErrorKind,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'AggregatorError';
  }

  /** Повтор задачи имеет смысл (временный сбой агрегатора). */
  get retryable(): boolean {
    return this.kind === 'unavailable';
  }
}

/** Трек длиннее лимита точек (`too_many_points`). */
export class TrackTooLongError extends Error {
  constructor() {
    super('workout track exceeds the point limit');
    this.name = 'TrackTooLongError';
  }
}

export class WebhookSignatureError extends Error {
  constructor(reason: string) {
    super(`webhook signature rejected: ${reason}`);
    this.name = 'WebhookSignatureError';
  }
}
