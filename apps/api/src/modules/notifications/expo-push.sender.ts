import { Logger } from '@nestjs/common';
import { z } from 'zod';

import {
  type PushMessage,
  type PushReceipt,
  PushSendError,
  type PushSender,
  type PushTicket,
} from './push-sender';

export interface ExpoPushConfig {
  /** `EXPO_PUSH_API_URL` (в production — только `https://exp.host/--/api/v2/push`). */
  apiUrl: string;
  /** `EXPO_ACCESS_TOKEN`; нет — без заголовка `Authorization`. */
  accessToken: string | null;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

/** Лимиты Expo Push API: ≤ 100 сообщений в `send`, ≤ 1000 id в `getReceipts`; таймаут и тело ответа — наши. */
export const EXPO_PUSH_LIMITS = {
  sendBatch: 100,
  receiptsBatch: 1000,
  timeoutMs: 10_000,
  maxBodyBytes: 1024 * 1024,
} as const;

const ErrorDetails = z.object({ error: z.string().max(100).optional() }).nullish();
const Ticket = z.union([
  z.object({ status: z.literal('ok'), id: z.string().min(1).max(200) }),
  z.object({ status: z.literal('error'), message: z.string().optional(), details: ErrorDetails }),
]);
const SendResponse = z.object({ data: z.array(Ticket).max(EXPO_PUSH_LIMITS.sendBatch) });
const Receipt = z.union([
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('error'), message: z.string().optional(), details: ErrorDetails }),
]);
const ReceiptsResponse = z.object({ data: z.record(z.string().max(200), Receipt) });

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
};

/**
 * Адаптер Expo Push API (ADR-0016) — единственное место, знающее его REST: `POST {url}/send` (массив ≤ 100 сообщений)
 * и `POST {url}/getReceipts { ids ≤ 1000 }`. Только адрес из env, без редиректов, таймаут 10 с, тело ответа ≤ 1 МБ,
 * ответы — zod. Ключ — только заголовок `Authorization`, и только если задан. Токены устройств, тела запросов и
 * ответов в логи и тексты ошибок не попадают: лог — маршрут, статус, число.
 */
export class ExpoPushSender implements PushSender {
  private readonly logger = new Logger(ExpoPushSender.name);
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;

  constructor(private readonly config: ExpoPushConfig) {
    this.base = config.apiUrl.replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? EXPO_PUSH_LIMITS.timeoutMs;
    this.maxBodyBytes = config.maxBodyBytes ?? EXPO_PUSH_LIMITS.maxBodyBytes;
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (const batch of chunks(messages, EXPO_PUSH_LIMITS.sendBatch)) {
      const body = batch.map((message) => ({
        to: message.to,
        title: message.title,
        body: message.body,
        sound: 'default',
        channelId: 'default',
        data: { target: message.target },
      }));
      const response = await this.request('send', body, SendResponse);
      if (response.data.length !== batch.length) {
        this.logger.warn(
          `expo.bad_response send tickets=${response.data.length} sent=${batch.length}`,
        );
        throw new PushSendError('protocol', 200, 'push service: tickets do not match messages');
      }
      for (const ticket of response.data) {
        tickets.push(
          ticket.status === 'ok'
            ? { status: 'ok', id: ticket.id }
            : { status: 'error', error: ticket.details?.error ?? null },
        );
      }
    }
    return tickets;
  }

  async receipts(ticketIds: readonly string[]): Promise<Map<string, PushReceipt>> {
    const receipts = new Map<string, PushReceipt>();
    for (const ids of chunks(ticketIds, EXPO_PUSH_LIMITS.receiptsBatch)) {
      const response = await this.request('getReceipts', { ids }, ReceiptsResponse);
      for (const id of ids) {
        const receipt = response.data[id];
        if (!receipt) continue;
        receipts.set(
          id,
          receipt.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', error: receipt.details?.error ?? null },
        );
      }
    }
    return receipts;
  }

  private async request<T>(
    method: 'send' | 'getReceipts',
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}/${method}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.config.accessToken
            ? { authorization: `Bearer ${this.config.accessToken}` }
            : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
      this.logger.warn(`expo.unavailable ${method} reason=${reason}`);
      throw new PushSendError('unavailable', null, `push service ${reason}`);
    }
    const { status } = response;
    if (status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      const kind = status === 429 || status >= 500 ? 'unavailable' : 'rejected';
      this.logger.warn(`expo.${kind} ${method} status=${status}`);
      throw new PushSendError(kind, status, `push service responded ${status}`);
    }
    const text = await this.readLimited(response, method);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PushSendError('protocol', status, 'push service response is not JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(`expo.bad_response ${method}`);
      throw new PushSendError('protocol', status, 'push service response does not match schema');
    }
    return parsed.data;
  }

  /** Тело ответа с обрывом на лимите (потоковый счётчик). */
  private async readLimited(response: Response, method: string): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBodyBytes) {
          await reader.cancel().catch(() => undefined);
          this.logger.warn(`expo.body_too_large ${method}`);
          throw new PushSendError('protocol', response.status, 'push service response too large');
        }
        parts.push(value);
      }
    } catch (error) {
      if (error instanceof PushSendError) throw error;
      throw new PushSendError('unavailable', response.status, 'push service response aborted');
    }
    return Buffer.concat(parts, size).toString('utf8');
  }
}
