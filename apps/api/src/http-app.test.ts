import 'reflect-metadata';

import { Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ApiError } from '@pokatim/contracts';
import { ApiExceptionFilter, createFastifyAdapter } from '@rkarakulov/api-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from './config/env';
import { configureHttp } from './http-app';

@Controller('probe')
class ProbeController {
  @Post()
  @HttpCode(200)
  change(): { ok: true } {
    return { ok: true };
  }

  @Get()
  read(): { ok: true } {
    return { ok: true };
  }
}

const DEV_WEB = 'http://127.0.0.1:8081';
let app: NestFastifyApplication | undefined;

async function createApp(
  corsOrigins: string[],
  nodeEnv: Env['NODE_ENV'] = 'production',
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ TRUST_PROXY: 0 }),
    { logger: false },
  );
  configureHttp(app, { CORS_ORIGINS: corsOrigins, NODE_ENV: nodeEnv });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const post = (target: NestFastifyApplication, headers: Record<string, string> = {}) =>
  target.inject({
    method: 'POST',
    url: '/v1/probe',
    headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers },
    payload: '{}',
  });

describe('configureHttp: CSRF (Fetch Metadata + Origin)', () => {
  it('префикс версии контракта: /v1/...', async () => {
    const res = await (await createApp([])).inject({ method: 'GET', url: '/v1/probe' });
    expect(res.statusCode).toBe(200);
  });

  it('cross-site POST → 403 FORBIDDEN в конверте ApiError', async () => {
    const res = await post(await createApp([DEV_WEB]), {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
    });
    expect(res.statusCode).toBe(403);
    expect(ApiError.parse(res.json())).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('form-POST с другого сайта (@fastify/formbody разбирает тело) → 403', async () => {
    const res = await (
      await createApp([DEV_WEB])
    ).inject({
      method: 'POST',
      url: '/v1/probe',
      headers: {
        host: '127.0.0.1:3000',
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
      },
      payload: 'refreshToken=x',
    });
    expect(res.statusCode).toBe(403);
  });

  it('same-site с недоверенного origin (другой порт того же хоста) → 403', async () => {
    const res = await post(await createApp([DEV_WEB]), {
      'sec-fetch-site': 'same-site',
      origin: 'http://127.0.0.1:9999',
    });
    expect(res.statusCode).toBe(403);
  });

  it('старый браузер без Sec-Fetch-Site: Origin не совпадает с Host → 403', async () => {
    const res = await post(await createApp([]), { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
  });

  it('same-origin (прод: web и API за одним origin) → 200', async () => {
    const res = await post(await createApp([]), {
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3000',
    });
    expect(res.statusCode).toBe(200);
  });

  it('native-клиент без Sec-Fetch-Site и Origin → 200', async () => {
    expect((await post(await createApp([]))).statusCode).toBe(200);
  });

  it('dev web из CORS_ORIGINS (same-site, другой порт) → 200', async () => {
    const res = await post(await createApp([DEV_WEB]), {
      'sec-fetch-site': 'same-site',
      origin: DEV_WEB,
    });
    expect(res.statusCode).toBe(200);
  });

  it('в проде (CORS_ORIGINS пуст) dev-origin не доверен → 403', async () => {
    const res = await post(await createApp([]), {
      'sec-fetch-site': 'same-site',
      origin: DEV_WEB,
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET cross-site пропускается (безопасный метод)', async () => {
    const res = await (
      await createApp([])
    ).inject({
      method: 'GET',
      url: '/v1/probe',
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('configureHttp: CORS с credentials только для CORS_ORIGINS', () => {
  const preflight = (target: NestFastifyApplication, origin: string) =>
    target.inject({
      method: 'OPTIONS',
      url: '/v1/probe',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

  it('preflight с origin из списка → Allow-Origin = origin и Allow-Credentials: true', async () => {
    const res = await preflight(await createApp([DEV_WEB]), DEV_WEB);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(DEV_WEB);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('preflight с чужого origin → без Allow-Origin (браузер не пустит запрос и не отдаст ответ)', async () => {
    const res = await preflight(await createApp([DEV_WEB]), 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS_ORIGINS пуст (прод) → CORS выключен', async () => {
    const res = await (
      await createApp([])
    ).inject({ method: 'GET', url: '/v1/probe', headers: { origin: DEV_WEB } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('configureHttp: предупреждение о пустом CORS_ORIGINS вне production', () => {
  const warnings = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  it('development, CORS_ORIGINS пуст → одна строка warn (web из браузера не достучится до API)', async () => {
    const warn = warnings();
    await createApp([], 'development');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('CORS_ORIGINS');
  });

  it('production, CORS_ORIGINS пуст → без предупреждения (web и API за одним origin)', async () => {
    const warn = warnings();
    await createApp([], 'production');
    expect(warn).not.toHaveBeenCalled();
  });

  it('development, CORS_ORIGINS задан → без предупреждения', async () => {
    const warn = warnings();
    await createApp([DEV_WEB], 'development');
    expect(warn).not.toHaveBeenCalled();
  });
});
