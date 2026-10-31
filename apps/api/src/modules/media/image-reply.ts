import type { AbstractHttpAdapter } from '@nestjs/core';

/**
 * Заголовки отдачи JPEG (аватар, фото райда): ставятся после чтения — Nest пишет `@Header` до обработчика, а 404 должен
 * уйти JSON-ом и без `immutable`. `sandbox` и `nosniff` — байты не исполняются и не угадываются.
 */
export function replyJpeg(
  adapter: AbstractHttpAdapter,
  reply: unknown,
  bytes: Buffer,
  cacheControl: string,
): Buffer {
  adapter.setHeader(reply, 'Content-Type', 'image/jpeg');
  adapter.setHeader(reply, 'Cache-Control', cacheControl);
  adapter.setHeader(reply, 'X-Content-Type-Options', 'nosniff');
  adapter.setHeader(reply, 'Content-Security-Policy', "default-src 'none'; sandbox");
  return bytes;
}
