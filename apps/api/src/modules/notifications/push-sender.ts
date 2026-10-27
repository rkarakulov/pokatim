import type { NotificationTarget } from '@pokatim/contracts';

/** Порт отправки push (ADR-0017): адаптер — `ExpoPushSender`; тесты доставки подменяют сервер (`test/fake-expo.ts`). */
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Сообщение одному устройству: текст — снимок уведомления или сводка, цель — из белого списка (сводка — `null`). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  target: NotificationTarget | null;
}

/** Тикет приёма сообщения (по порядку сообщений): ошибка — код Expo (`DeviceNotRegistered`, …) или `null`. */
export type PushTicket = { status: 'ok'; id: string } | { status: 'error'; error: string | null };

/** Квитанция доставки по id тикета (≥ 15 мин после отправки). */
export type PushReceipt = { status: 'ok' } | { status: 'error'; error: string | null };

/** Устройство снято с регистрации (приложение удалено, токен устарел): токен снимается сразу. */
export const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

export type PushSendErrorKind = 'unavailable' | 'rejected' | 'protocol';

/**
 * Сбой запроса к сервису push: `unavailable` — сеть, таймаут, 429, 5xx (повтор задачи); `rejected` — прочие 4xx;
 * `protocol` — редирект, не JSON, ответ не по схеме, слишком большое тело. Без токенов и тел в тексте.
 */
export class PushSendError extends Error {
  constructor(
    readonly kind: PushSendErrorKind,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'PushSendError';
  }
}

export interface PushSender {
  /** Отправка сообщений (адаптер режет на пачки); тикеты — в порядке сообщений. */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  /** Квитанции по id тикетов (адаптер режет на пачки); квитанции ещё нет — id нет в карте. */
  receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>>;
}
