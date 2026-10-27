import type { Readable } from 'node:stream';

import type { ErrorCode } from '@pokatim/contracts';

import { domainError } from './error-messages';

/** Коды ответа загрузки: тело не поток (`application/octet-stream`) — 415; больше лимита — 413. */
export interface RawBodyErrors {
  unsupported: ErrorCode;
  tooLarge: ErrorCode;
}

/** Таймауты чтения тела: тишина между порциями и всё тело. */
export interface BodyTimeouts {
  idleMs: number;
  totalMs: number;
}

/**
 * Таймауты тела загрузок по умолчанию (`[ASSUMPTION]` upload-limits-kml-panel §2): тишина 30 с, всё тело 180 с
 * (16 МиБ заезда на 1 Мбит/с ≈ 135 с, 5 МиБ маршрута на 0,5 Мбит/с ≈ 80 с). Политики модулей ссылаются на них.
 */
export const DEFAULT_BODY_TIMEOUTS: BodyTimeouts = { idleMs: 30_000, totalMs: 180_000 };

/** Тело не пришло вовремя — `408` без нового кода контракта. */
const bodyTimedOut = () =>
  domainError('VALIDATION_FAILED', 408, { fields: [{ path: 'body', code: 'INVALID' }] });

/**
 * Тело загрузки — сырой поток (`application/octet-stream`, парсер `http-app.ts` передаёт его без чтения): читается
 * обработчиком после гарда и лимитов, с обрывом на лимите — `413` с кодом контракта (глобальный `bodyLimit` 64 КБ
 * остальных маршрутов не меняется). Другой тип содержимого — `415`. Тишина дольше `idleMs` или всё тело дольше
 * `totalMs` — `408` (медленная отправка не держит слот приёма). При отказе остаток тела сливается без хранения,
 * обработчик отвечает с `Connection: close`. Общий для загрузок заездов и маршрутов.
 */
export function readLimited(
  body: unknown,
  maxBytes: number,
  errors: RawBodyErrors,
  timeouts: BodyTimeouts,
): Promise<Uint8Array> {
  if (!isReadable(body)) return Promise.reject(domainError(errors.unsupported, 415));
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const fail = (error: Error) => {
      cleanup();
      // не рвём соединение (клиент получил бы обрыв вместо ответа): остаток тела сливается без хранения, ответ
      // уходит с `Connection: close`; обрыв клиента во время слива — без необработанной ошибки потока
      body.on('error', () => undefined);
      body.resume();
      reject(error);
    };
    const timedOut = () => fail(bodyTimedOut());
    const total = setTimeout(timedOut, timeouts.totalMs);
    let idle = setTimeout(timedOut, timeouts.idleMs);
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.byteLength;
      if (size > maxBytes) {
        fail(domainError(errors.tooLarge, 413));
        return;
      }
      chunks.push(buffer);
      clearTimeout(idle);
      idle = setTimeout(timedOut, timeouts.idleMs);
    };
    const onEnd = () => {
      cleanup();
      resolve(new Uint8Array(Buffer.concat(chunks, size)));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(total);
      clearTimeout(idle);
      body.off('data', onData);
      body.off('end', onEnd);
      body.off('error', onError);
    };
    body.on('data', onData);
    body.once('end', onEnd);
    body.once('error', onError);
  });
}

function isReadable(value: unknown): value is Readable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Readable).pipe === 'function' &&
    typeof (value as Readable)[Symbol.asyncIterator] === 'function'
  );
}
