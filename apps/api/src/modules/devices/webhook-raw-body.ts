import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { DEVICES_POLICY } from './devices.policy';

/** Флаг маршрута (`@RouteConfig`): сохранить сырые байты тела для проверки подписи. */
export const RAW_BODY_ROUTE = 'devicesRawBody';

const rawBodies = new WeakMap<IncomingMessage, Buffer>();

/** Сырые байты тела запроса маршрута с `RAW_BODY_ROUTE` (для подписи Svix). */
export function rawBodyOf(request: { raw: IncomingMessage }): Buffer | undefined {
  return rawBodies.get(request.raw);
}

interface HookRequest {
  raw: IncomingMessage;
  routeOptions: { config?: Record<string, unknown> };
}

type Done = (error: Error | null, payload?: NodeJS.ReadableStream) => void;

interface HookInstance {
  addHook(
    name: 'preParsing',
    hook: (
      request: HookRequest,
      reply: unknown,
      payload: NodeJS.ReadableStream,
      done: Done,
    ) => void,
  ): unknown;
}

class BodyTooLargeError extends Error {
  readonly statusCode = 413;
  constructor() {
    super('webhook body too large');
  }
}

/**
 * Сырые байты тела вебхука без смены глобального парсера JSON: хук Fastify `preParsing` срабатывает только на
 * маршрутах с `@RouteConfig({ [RAW_BODY_ROUTE]: true })` — читает тело (≤ 256 КБ, больше — 413), запоминает байты
 * (WeakMap по запросу) и отдаёт парсеру JSON их же. Общий `bodyLimit` 64 КБ остальных маршрутов (и этого — на
 * стадии разбора JSON) не меняется. Хук ставится до `ready()` Fastify (Nest вызывает `onModuleInit` до него), поэтому
 * попадает в контекст уже зарегистрированных маршрутов.
 */
@Injectable()
export class WebhookRawBodyHook implements OnModuleInit {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit(): void {
    const instance = this.adapterHost.httpAdapter.getInstance<HookInstance>();
    instance.addHook('preParsing', (request, _reply, payload, done) => {
      if (request.routeOptions.config?.[RAW_BODY_ROUTE] !== true) {
        done(null, payload);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const finish = (error: Error | null) => {
        if (finished) return;
        finished = true;
        if (error) {
          done(error);
          return;
        }
        const body = Buffer.concat(chunks, size);
        rawBodies.set(request.raw, body);
        done(null, Readable.from([body]));
      };
      payload.on('data', (chunk: Buffer | string) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        size += buffer.byteLength;
        if (size > DEVICES_POLICY.webhookMaxBytes) {
          payload.removeAllListeners('data');
          finish(new BodyTooLargeError());
          return;
        }
        chunks.push(buffer);
      });
      payload.on('end', () => finish(null));
      payload.on('error', (error: Error) => finish(error));
    });
  }
}
