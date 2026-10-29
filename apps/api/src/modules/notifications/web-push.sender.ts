import { Logger } from '@nestjs/common';
import { isWebPushEndpoint, type NotificationTarget } from '@pokatim/contracts';

import type { PushSendErrorKind } from './push-sender';
import {
  encryptWebPush,
  type VapidKeys,
  VapidSigner,
  WEB_PUSH_MAX_PLAINTEXT,
  type WebPushKeys,
} from './web-push.crypto';

/** Порт отправки Web Push (ADR-0021): адаптер — `HttpWebPushSender`; тесты доставки — фейковый push-сервис. */
export const WEB_PUSH_SENDER = Symbol('WEB_PUSH_SENDER');

/** Подписка браузера: endpoint push-сервиса и ключи шифрования. */
export interface WebPushTarget extends WebPushKeys {
  endpoint: string;
}

/** Payload, который видит service worker: текст — снимок уведомления или сводка, цель — из белого списка. */
export interface WebPushPayload {
  title: string;
  body: string;
  target: NotificationTarget | null;
}

/**
 * Итог одной подписки: `ok` — push-сервис принял (201/202); `gone` — подписки больше нет (404/410) или её ключи
 * непригодны для шифрования, снять сразу;
 * `error` — `unavailable` (сеть, таймаут, 429, 5xx — повтор задачи), `rejected` (прочие 4xx, чужой хост) или
 * `protocol` (редирект).
 */
export type WebPushResult =
  | { status: 'ok' }
  | { status: 'gone' }
  | { status: 'error'; kind: PushSendErrorKind; code: string };

export interface WebPushSender {
  /** Не бросает: сбой — `error` в результате. */
  send(subscription: WebPushTarget, payload: WebPushPayload): Promise<WebPushResult>;
}

export interface WebPushConfig {
  vapid: VapidKeys;
  /** `WEB_PUSH_TEST_ORIGIN` — только тесты: origin фейкового push-сервиса вне белого списка. */
  testOrigin?: string | null;
  timeoutMs?: number;
  /** Сколько живёт сообщение у push-сервиса, пока браузер офлайн. */
  ttlSec?: number;
  now?: () => Date;
}

export const WEB_PUSH_LIMITS = { timeoutMs: 10_000, ttlSec: 24 * 3600 } as const;

/** Тексты в payload — не длиннее (снимки уведомлений короче); байты тела сверяет `encodePayload`. */
const TITLE_MAX = 150;
const BODY_MAX = 900;

/**
 * Адаптер Web Push (RFC 8030/8291/8292) — единственное место, знающее протокол: POST на endpoint подписки, тело —
 * aes128gcm, `Authorization: vapid …`, `TTL`, `Urgency: normal`. Endpoint — только push-сервис из белого списка
 * контракта (повторная проверка перед запросом, SSRF), редирект не исполняется (`manual` → `protocol`), таймаут 10 с, тело ответа не читается.
 * Endpoint, ключи и JWT в логи и тексты ошибок не попадают: лог — хост, статус.
 */
export class HttpWebPushSender implements WebPushSender {
  private readonly logger = new Logger(HttpWebPushSender.name);
  private readonly signer: VapidSigner;
  private readonly timeoutMs: number;
  private readonly ttlSec: number;
  private readonly now: () => Date;

  constructor(private readonly config: WebPushConfig) {
    this.signer = new VapidSigner(config.vapid);
    this.timeoutMs = config.timeoutMs ?? WEB_PUSH_LIMITS.timeoutMs;
    this.ttlSec = config.ttlSec ?? WEB_PUSH_LIMITS.ttlSec;
    this.now = config.now ?? (() => new Date());
  }

  async send(subscription: WebPushTarget, payload: WebPushPayload): Promise<WebPushResult> {
    if (!this.allowed(subscription.endpoint)) {
      this.logger.warn('webpush.endpoint_rejected');
      return { status: 'error', kind: 'rejected', code: 'endpoint_not_allowed' };
    }
    const url = new URL(subscription.endpoint);
    let body: Buffer;
    try {
      body = encryptWebPush(encodePayload(payload), subscription);
    } catch (error) {
      // ключ подписки — не точка P-256: подписка непригодна навсегда, снять; прочее — наша ошибка, подписку не трогаем
      if ((error as { code?: unknown }).code === 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY') {
        return { status: 'gone' };
      }
      const code = error instanceof RangeError ? 'payload_too_large' : 'encrypt_failed';
      this.logger.warn(`webpush.${code}`);
      return { status: 'error', kind: 'rejected', code };
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          authorization: await this.signer.authorization(url.origin, this.now()),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(this.ttlSec),
          urgency: 'normal',
        },
        body: new Uint8Array(body),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
      this.logger.warn(`webpush.unavailable host=${url.hostname} reason=${reason}`);
      return { status: 'error', kind: 'unavailable', code: reason };
    }
    const { status } = response;
    await response.body?.cancel().catch(() => undefined);
    if (status === 201 || status === 202 || status === 200) return { status: 'ok' };
    if (status === 404 || status === 410) return { status: 'gone' };
    const kind: PushSendErrorKind =
      status === 429 || status >= 500 ? 'unavailable' : status < 400 ? 'protocol' : 'rejected';
    this.logger.warn(`webpush.${kind} host=${url.hostname} status=${status}`);
    return { status: 'error', kind, code: `http_${status}` };
  }

  private allowed(endpoint: string): boolean {
    // строка и её нормализованный URL — оба на хосте push-сервиса (расхождение разборов не обходит белый список)
    if (isWebPushEndpoint(endpoint) && URL.canParse(endpoint)) {
      return isWebPushEndpoint(new URL(endpoint).href);
    }
    const { testOrigin } = this.config;
    return !!testOrigin && URL.canParse(endpoint) && new URL(endpoint).origin === testOrigin;
  }
}

/**
 * JSON payload в пределах тела push-сервиса: тексты обрезаются по символам, затем — если экранирование JSON раздуло
 * байты — текст уведомления укорачивается вдвое, пока не влезет (заголовок ≤ 150 символов влезает всегда).
 */
export function encodePayload(payload: WebPushPayload): Buffer {
  const cut = (text: string, max: number) =>
    text.length <= max ? text : max <= 1 ? '' : `${text.slice(0, max - 1)}…`;
  const title = cut(payload.title, TITLE_MAX);
  let body = cut(payload.body, BODY_MAX);
  for (;;) {
    const bytes = Buffer.from(JSON.stringify({ title, body, target: payload.target }), 'utf8');
    if (bytes.length <= WEB_PUSH_MAX_PLAINTEXT || body.length === 0) return bytes;
    body = cut(body, Math.floor(body.length / 2));
  }
}
