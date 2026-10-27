/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { CatalogRouteDetail } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import ReportRouteRoute from '../app/routes/report/[id]';
import { appRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getViewer = jest.mocked(api.getCatalogRouteViewer);
const getRoute = jest.mocked(api.getCatalogRoute);
const report = jest.mocked(api.reportCatalogRoute);

const ID = '0190a6f4-0000-7000-8000-000000000009';
const route: CatalogRouteDetail = {
  id: ID,
  title: 'Лесная петля',
  distanceM: 42_000,
  elevationGainM: 310,
  isLoop: true,
  city: 'minsk',
  surfaces: ['gravel'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  author: { kind: 'rider', name: null },
  elevation: null,
  gpxAvailable: true,
};
const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: 'x', ...(details ? { details } : {}) });

const routes = {
  'routes/report/[id]': ReportRouteRoute,
  'routes/[id]': () => <Text>Карточка маршрута</Text>,
};
const open = (url = `/routes/report/${ID}`) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getViewer.mockResolvedValue({ canReport: true, reported: false });
  getRoute.mockResolvedValue(route);
  report.mockResolvedValue({ canReport: false, reported: true });
});
afterEach(() => jest.clearAllMocks());

describe('«Пожаловаться на маршрут» (routes-06, A4)', () => {
  it('причина обязательна; комментарий; «Отправить» → баннер успеха и «К маршруту»', async () => {
    const router = await open();
    expect(await screen.findByText('Лесная петля')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    for (const reason of [
      'Опасный маршрут',
      'Непроезжий',
      'Частная или закрытая территория',
      'Оскорбительное название',
      'Спам',
      'Другое',
    ]) {
      expect(screen.getByText(reason)).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByText('Частная или закрытая территория'));
    await fireEvent.changeText(
      screen.getByLabelText('Комментарий — необязательно'),
      '  Шлагбаум на въезде ',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        reason: 'private_area',
        comment: 'Шлагбаум на въезде',
      }),
    );
    expect(
      await screen.findByText('Жалоба отправлена — команда проверит маршрут.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
    await fireEvent.press(screen.getByText('К маршруту'));
    expect(router.getPathname()).toBe(`/routes/${ID}`);
  });

  it('без комментария — null; комментарий длиннее 500 — ошибка под полем, без запроса', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Спам'));
    await fireEvent.changeText(
      screen.getByLabelText('Комментарий — необязательно'),
      'я'.repeat(501),
    );
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Комментарий — необязательно'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        reason: 'spam',
        comment: null,
      }),
    );
  });

  it.each([
    [
      http(409, 'ROUTE_INVALID_STATE', { reason: 'own_route' }),
      'На свой маршрут пожаловаться нельзя',
    ],
    [
      http(409, 'ROUTE_INVALID_STATE', { reason: 'team_route' }),
      'На маршрут команды пожаловаться нельзя',
    ],
    [
      http(429, 'RATE_LIMITED', { retryAfterSec: 60 }),
      'Слишком много жалоб за сутки. Попробуйте завтра.',
    ],
    [
      new ApiNetworkError(new Error('offline')),
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    ],
    [http(404, 'NOT_FOUND'), 'Маршрут недоступен'],
  ])('отказ %# — баннер с причиной', async (error, text) => {
    report.mockRejectedValue(error);
    await open();
    await fireEvent.press(await screen.findByText('Спам'));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('уже жаловался — «Вы пожаловались на этот маршрут», без формы', async () => {
    getViewer.mockResolvedValue({ canReport: false, reported: true });
    await open();
    expect(await screen.findByText('Вы пожаловались на этот маршрут')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });

  it('свой маршрут или маршрут команды (canReport false) — «нельзя пожаловаться»', async () => {
    getViewer.mockResolvedValue({ canReport: false, reported: false });
    await open();
    expect(await screen.findByText('На этот маршрут нельзя пожаловаться')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });

  it('не в каталоге (404) — «Маршрут недоступен»; невалидный id — без запроса', async () => {
    getViewer.mockRejectedValue(http(404, 'NOT_FOUND'));
    getRoute.mockRejectedValue(http(404, 'NOT_FOUND'));
    await open();
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
  });

  it('невалидный id — «Маршрут недоступен» без запроса', async () => {
    await open('/routes/report/not-a-uuid');
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(getViewer).not.toHaveBeenCalled();
  });

  it('гость по ссылке — гард ведёт на вход, запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    const router = await renderRouter(appRoutes, { initialUrl: `/routes/report/${ID}` });
    await waitFor(() => expect(router.getPathname()).not.toBe(`/routes/report/${ID}`));
    expect(getViewer).not.toHaveBeenCalled();
  });
});
