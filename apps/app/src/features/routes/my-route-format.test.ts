/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { MyRoute } from '@pokatim/contracts';

import { myRouteErrorMessage } from './error-messages';
import {
  defaultRouteTitle,
  myRouteStats,
  myRouteStatus,
  myRouteUploadedAt,
} from './my-route-format';

const route = (overrides: Partial<MyRoute> = {}): MyRoute => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Кольцо',
  status: 'ready',
  failure: null,
  distanceM: 42_000,
  elevationGainM: 310,
  isLoop: true,
  createdAt: '2026-10-26T21:30:00.000Z',
  publication: null,
  canPublish: false,
  submissionsExhausted: false,
  ...overrides,
});

describe('название по умолчанию (routes-02, RC-6)', () => {
  it.each([
    ['Кольцо.gpx', 'Кольцо'],
    ['a.b.kml', 'a.b'],
    ['без-расширения', 'без-расширения'],
    ['  Утро\nвечер.GPX ', 'Утро вечер'],
    ['tab\there.kml', 'tab here'],
  ])('%j → %j', (name, title) => {
    expect(defaultRouteTitle(name)).toBe(title);
  });

  it('длиннее 120 символов — обрезается до 120', () => {
    expect(defaultRouteTitle(`${'я'.repeat(200)}.gpx`)).toBe('я'.repeat(120));
  });
});

describe('статус своего маршрута', () => {
  it('готов — без статуса; обрабатывается; отказ — причина; незнакомое — «Не удалось обработать»', () => {
    expect(myRouteStatus(route())).toBeNull();
    expect(myRouteStatus(route({ status: 'processing' }))).toEqual({
      label: 'Обрабатывается',
      tone: 'neutral',
    });
    expect(myRouteStatus(route({ status: 'failed', failure: 'no_track' }))).toEqual({
      label: 'В файле нет линии маршрута',
      tone: 'error',
    });
    expect(myRouteStatus(route({ status: 'failed', failure: 'unknown' }))).toEqual({
      label: 'Не удалось обработать',
      tone: 'error',
    });
    expect(myRouteStatus(route({ status: 'unknown' }))).toEqual({
      label: 'Не удалось обработать',
      tone: 'error',
    });
  });

  it('цифры готового и дата загрузки по Минску (с годом)', () => {
    expect(myRouteStats(route())?.replace(/\u00a0/g, ' ')).toBe('42 км · набор 310 м · петля');
    expect(myRouteStats(route({ status: 'processing', distanceM: null }))).toBeNull();
    expect(myRouteUploadedAt(route())).toBe('27 октября 2026');
  });
});

describe('тексты ошибок загрузки', () => {
  const http = (status: number, code: string) => new ApiHttpError(status, { code, message: 'x' });
  it.each([
    [http(415, 'ROUTE_FORMAT_UNSUPPORTED'), 'Формат не поддерживается — выберите GPX или KML'],
    [http(413, 'ROUTE_TOO_LARGE'), 'Файл слишком большой — до 5 МБ'],
    [http(429, 'RATE_LIMITED'), 'Слишком много загрузок. Попробуйте позже.'],
    [http(409, 'ROUTE_QUOTA_EXCEEDED'), 'Можно хранить до 100 маршрутов — удалите ненужные'],
    [http(500, 'INTERNAL'), 'Не удалось загрузить маршрут'],
  ])('%s → %s', (error, message) => {
    expect(myRouteErrorMessage(error)).toBe(message);
  });

  it('нет сети — «Нет соединения»', () => {
    expect(myRouteErrorMessage(new ApiNetworkError(new TypeError('x')))).toMatch(/^Нет соединения/);
  });
});
