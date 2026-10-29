/// <reference types="jest" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { RequestHandler } from 'express';

import {
  CSP_NONCE_HEADER,
  MAP_ORIGINS,
  contentSecurityPolicy,
  createWebServer,
  securityHeaders,
} from './web-server.ts';

const ENTRY = '/_expo/static/js/web/entry-0123abcd.js';
const SECRET = 'секрет вне dist/client';
const REPO = resolve(__dirname, '../../..');
const API_URL = 'https://api.example.test/base/';

let dist: string;
let server: Server;
let base: string;

// заголовки запроса так, как их видит рендер Expo: expo-server строит `Request` из `req.rawHeaders`
const renderedHeaders = (rawHeaders: string[]) => {
  const headers = new Headers();
  for (let i = 0; i < rawHeaders.length; i += 2) headers.append(rawHeaders[i]!, rawHeaders[i + 1]!);
  return headers;
};

// вместо SSR Expo: HTML на «/» (с nonce из заголовка запроса, как +html.tsx), 404 на остальное
const render: RequestHandler = (req, res) => {
  const nonce = renderedHeaders(req.rawHeaders).get(CSP_NONCE_HEADER) ?? '';
  if (req.path === '/')
    res.type('html').send(`<!doctype html><title>Главная</title><i>${nonce}</i>`);
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
function get(path: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    httpRequest(base, { path, headers }, (res) => {
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
  server = createWebServer({ dist, render, apiUrl: API_URL }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dist, { recursive: true, force: true });
});

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)
    ?.slice(1);

const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];

function expectSecurityHeaders({ headers }: Reply) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    expect(headers[name.toLowerCase()]).toBe(value);
  }
  const csp = String(headers['content-security-policy']);
  expect(csp).toBe(contentSecurityPolicy(nonceOf(csp)!, API_URL));
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
    // билет: код в адресе не уходит внешним сайтам («Как добраться», «О событии»)
    '/tickets/ABCDE12345',
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

  it('HTML: nonce CSP — тот же, что видит рендер в заголовке запроса; у каждого ответа свой', async () => {
    const first = await get('/');
    const second = await get('/');
    const nonce = nonceOf(String(first.headers['content-security-policy']));
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.body).toContain(`<i>${nonce}</i>`);
    expect(nonceOf(String(second.headers['content-security-policy']))).not.toBe(nonce);
  });

  it.each([CSP_NONCE_HEADER, CSP_NONCE_HEADER.toUpperCase()])(
    'клиент не навязывает nonce: входящий %s вырезается',
    async (name) => {
      const response = await get('/', { [name]: 'attacker' });
      const nonce = nonceOf(String(response.headers['content-security-policy']));
      expect(response.body).toContain(`<i>${nonce}</i>`);
      expect(response.body).not.toContain('attacker');
    },
  );
});

describe('политика CSP web приложения (ADR-0025)', () => {
  const csp = contentSecurityPolicy('n0nce', API_URL);

  it('скрипты — свой origin и nonce ответа: без unsafe-inline, unsafe-eval и strict-dynamic', () => {
    expect(directive(csp, 'script-src')).toEqual(["'self'", "'nonce-n0nce'"]);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('strict-dynamic');
  });

  it('стили RN-web — unsafe-inline без nonce (nonce отключил бы unsafe-inline)', () => {
    expect(directive(csp, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('API — origin EXPO_PUBLIC_API_URL в connect-src и img-src (аватары); карты — в connect-src', () => {
    expect(directive(csp, 'connect-src')).toEqual([
      "'self'",
      'https://api.example.test',
      ...MAP_ORIGINS,
    ]);
    expect(directive(csp, 'img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://api.example.test',
    ]);
  });

  it('API на том же origin (прод) — без дубля', () => {
    expect(directive(contentSecurityPolicy('n', undefined), 'connect-src')).toEqual([
      "'self'",
      ...MAP_ORIGINS,
    ]);
  });

  it('запрещающие директивы', () => {
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'worker-src')).toEqual(["'self'", 'blob:']);
    expect(directive(csp, 'font-src')).toEqual(["'self'"]);
    expect(directive(csp, 'manifest-src')).toEqual(["'self'"]);
  });

  it('origin стиля карт стенда (deploy-dev.yml) — в connect-src: смена провайдера без CSP — красный тест', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/deploy-dev.yml'), 'utf8');
    const styles = [...workflow.matchAll(/EXPO_PUBLIC_MAP_STYLE_(?:LIGHT|DARK)=(\S+)/g)].map(
      ([, url]) => new URL(url!).origin,
    );
    expect(styles.length).toBeGreaterThan(0);
    for (const origin of styles) expect(MAP_ORIGINS).toContain(origin);
  });

  it('nonce до рендера: патч @expo/router-server читает тот же заголовок, +html — через cspNonce()', () => {
    const workspace = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8');
    const patchPath = /'@expo\/router-server@[^']+': (\S+)/.exec(workspace)?.[1];
    expect(patchPath).toBeDefined();
    const patch = readFileSync(join(REPO, patchPath!), 'utf8');
    expect(patch).toContain(`'${CSP_NONCE_HEADER}'`);
    expect(patch).toMatch(/^\+\s+nonce,?$/m);
    const nonceModule = readFileSync(
      join(REPO, 'apps/app/src/features/web-security/csp-nonce.ts'),
      'utf8',
    );
    expect(nonceModule).toContain(`'${CSP_NONCE_HEADER}'`);
  });
});
