import { PassThrough } from 'node:stream';

import { vi } from 'vitest';

import { UploadSlots } from '../src/upload-slots';
import type { Harness } from './harness';
import type { UploadResult } from './tracks';

/**
 * Загрузка с удерживаемым телом (upload-limits-kml-panel): тело — поток, обработчик читает его, пока тест не вызовет
 * `finish` (или `abort`). `held` — дождаться, что этот запрос занял слот приёма (spy `UploadSlots.tryAcquire`).
 */
export function heldUpload(h: Harness, url: string, headers: Record<string, string>) {
  const acquire = vi.spyOn(UploadSlots.prototype, 'tryAcquire');
  const calls = acquire.mock.results.length;
  const body = new PassThrough();
  const response = h.app
    .inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/octet-stream', ...headers },
      payload: body,
    })
    .then((reply): UploadResult => ({
      status: reply.statusCode,
      body: reply.body ? (JSON.parse(reply.body) as unknown) : undefined,
      headers: reply.headers,
    }));
  return {
    /** Запрос получил слот и читает тело. */
    held: () =>
      vi.waitFor(() => {
        const result = acquire.mock.results[calls];
        if (result?.type !== 'return' || result.value === null) throw new Error('slot not taken');
      }),
    /** Часть тела (приём идёт). */
    write: (bytes: Buffer) => body.write(bytes),
    finish: (bytes: Buffer): Promise<UploadResult> => {
      body.end(bytes);
      return response;
    },
    /** Ответ без дописывания тела (таймаут тела). */
    response,
  };
}
