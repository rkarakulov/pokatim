/// <reference types="jest" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { RequestHandler } from 'express';

import { createWebServer, securityHeaders } from './web-server.ts';

const ENTRY = '/_expo/static/js/web/entry-0123abcd.js';
const SECRET = 'секрет вне dist/client';

let dist: string;
let server: Server;
let base: string;

// вместо SSR Expo: HTML на «/», 404 на остальное
const render: RequestHandler = (req, res) => {
  if (req.path === '/') res.type('html').send('<!doctype html><title>Главная</title>');
  else res.status(404).type('html').send('<!doctype html><title>Не найдено</title>');
};

function put(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

// node:http, а не fetch: путь уходит как есть (fetch нормализует «..»)
function get(path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    httpRequest(base, { path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    })
      .on('error', reject)
      .end();
  });
}

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'web-server-'));
  put(join(dist, 'client', ENTRY), 'console.log("entry")');
  put(join(dist, 'client', 'sw.js'), 'self.addEventListener("fetch", () => {})');
  put(join(dist, 'secret.txt'), SECRET);
  server = createWebServer({ dist, render }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dist, { recursive: true, force: true });
});

function expectSecurityHeaders({ headers }: Reply) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    expect(headers[name.toLowerCase()]).toBe(value);
  }
  expect(headers['x-powered-by']).toBeUndefined();
}

describe('web-сервер', () => {
  it('HTML (SSR): заголовки безопасности', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.body).toContain('Главная');
    expectSecurityHeaders(response);
  });

  it('хешированная статика /_expo/static — immutable на год', async () => {
    const response = await get(ENTRY);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expectSecurityHeaders(response);
  });

  it('прочая статика (sw.js) — no-cache: новая сборка видна сразу', async () => {
    const response = await get('/sw.js');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    expectSecurityHeaders(response);
  });

  it('неизвестный путь — ответ рендера (404)', async () => {
    const response = await get('/nope');
    expect(response.status).toBe(404);
    expectSecurityHeaders(response);
  });

  it.each([
    '/auth/reset/x',
    '/auth/verify/x',
    '/devices/return?provider=garmin&result=pending&t=x',
  ])(
    'путь с токеном (%s) — Referrer-Policy: no-referrer, остальные заголовки те же',
    async (path) => {
      const { headers } = await get(path);
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['x-content-type-options']).toBe('nosniff');
    },
  );

  it.each(['/', '/sign-in', '/authx', '/devices', '/devices/returnx', '/settings/devices'])(
    'прочие пути (%s) — прежний Referrer-Policy',
    async (path) => {
      const { headers } = await get(path);
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    },
  );

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/_expo/..%2f..%2fsecret.txt'])(
    'файл вне dist/client не отдаётся: %s',
    async (path) => {
      const { status, body } = await get(path);
      expect(status).not.toBe(200);
      expect(body).not.toContain(SECRET);
    },
  );
});
