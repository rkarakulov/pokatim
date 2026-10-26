import type { Readable } from 'node:stream';

import type { ErrorCode } from '@pokatim/contracts';

import { domainError } from './error-messages';

/** Коды ответа загрузки: тело не поток (`application/octet-stream`) — 415; больше лимита — 413. */
export interface RawBodyErrors {
  unsupported: ErrorCode;
  tooLarge: ErrorCode;
}

/**
 * Тело загрузки — сырой поток (`application/octet-stream`, парсер `http-app.ts` передаёт его без чтения): читается
 * обработчиком после гарда и лимитов, с обрывом на лимите — `413` с кодом контракта (глобальный `bodyLimit` 64 КБ
 * остальных маршрутов не меняется). Другой тип содержимого — `415`. Общий для загрузок заездов и маршрутов.
 */
export function readLimited(
  body: unknown,
  maxBytes: number,
  errors: RawBodyErrors,
): Promise<Uint8Array> {
  if (!isReadable(body)) return Promise.reject(domainError(errors.unsupported, 415));
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.byteLength;
      if (size > maxBytes) {
        // не рвём соединение (клиент получил бы обрыв вместо 413): остаток тела сливается без хранения, ответ
        // 413 уходит с `Connection: close`
        cleanup();
        body.resume();
        reject(domainError(errors.tooLarge, 413));
        return;
      }
      chunks.push(buffer);
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
