/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import ReportRiderRoute from '../app/riders/report/[id]';
import { appRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getViewer = jest.mocked(api.getRiderViewer);
const report = jest.mocked(api.reportRider);

const PUBLIC_ID = 'r'.repeat(43);
const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: 'x', ...(details ? { details } : {}) });

const routes = {
  'riders/report/[id]': ReportRiderRoute,
  'riders/[id]': () => <Text>Профиль райдера</Text>,
};
const open = (url = `/riders/report/${PUBLIC_ID}`) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getViewer.mockResolvedValue({ canReport: true, reported: false });
  report.mockResolvedValue({ canReport: false, reported: true });
});
afterEach(() => jest.clearAllMocks());

describe('«Пожаловаться на профиль» (profile-report-app)', () => {
  it('причина обязательна; комментарий; «Отправить» → баннер успеха и «К профилю»', async () => {
    const router = await open();
    expect(await screen.findByText('Неприемлемое фото')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    for (const reason of [
      'Неприемлемый клуб',
      'Неприемлемое имя',
      'Выдаёт себя за другого',
      'Спам или реклама',
      'Другое',
    ]) {
      expect(screen.getByText(reason)).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByText('Выдаёт себя за другого'));
    await fireEvent.changeText(
      screen.getByLabelText('Комментарий — необязательно'),
      '  Это не он ',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith(liveSession.accessToken, PUBLIC_ID, {
        reason: 'impersonation',
        comment: 'Это не он',
      }),
    );
    expect(
      await screen.findByText('Жалоба отправлена — команда проверит профиль.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
    await fireEvent.press(screen.getByText('К профилю'));
    expect(router.getPathname()).toBe(`/riders/${PUBLIC_ID}`);
  });

  it('без комментария — null; комментарий длиннее 500 — ошибка под полем, без запроса', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Неприемлемое фото'));
    await fireEvent.changeText(
      screen.getByLabelText('Комментарий — необязательно'),
      'я'.repeat(501),
    );
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Комментарий — необязательно'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith(liveSession.accessToken, PUBLIC_ID, {
        reason: 'photo',
        comment: null,
      }),
    );
  });

  it.each([
    [
      http(409, 'PROFILE_INVALID_STATE', { reason: 'own_profile' }),
      'На свой профиль пожаловаться нельзя',
    ],
    [http(409, 'PROFILE_INVALID_STATE'), 'Не удалось отправить жалобу'],
    [
      http(429, 'RATE_LIMITED', { retryAfterSec: 60 }),
      'Слишком много жалоб за сутки. Попробуйте завтра.',
    ],
    [
      new ApiNetworkError(new Error('offline')),
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    ],
    [http(404, 'NOT_FOUND'), 'Профиль недоступен'],
    [http(500, 'INTERNAL'), 'Не удалось отправить жалобу'],
  ])('отказ %# — баннер с причиной', async (error, text) => {
    report.mockRejectedValue(error);
    await open();
    await fireEvent.press(await screen.findByText('Другое'));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('уже жаловался — «Вы пожаловались на этот профиль», без формы', async () => {
    getViewer.mockResolvedValue({ canReport: false, reported: true });
    await open();
    expect(await screen.findByText('Вы пожаловались на этот профиль')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });

  it('свой профиль (canReport false) — «нельзя пожаловаться»', async () => {
    getViewer.mockResolvedValue({ canReport: false, reported: false });
    await open();
    expect(await screen.findByText('На этот профиль нельзя пожаловаться')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });

  it('профиль скрыт (404 me) — «Профиль недоступен» без формы', async () => {
    getViewer.mockRejectedValue(http(404, 'NOT_FOUND'));
    await open();
    expect(await screen.findByText('Профиль недоступен')).toBeOnTheScreen();
    expect(screen.queryByText('Неприемлемое фото')).toBeNull();
  });

  it('ошибка me — «Не удалось загрузить» с повтором', async () => {
    getViewer.mockRejectedValueOnce(http(500, 'INTERNAL'));
    await open();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText('Неприемлемое фото')).toBeOnTheScreen();
  });

  it('невалидный id — «Профиль недоступен» без запроса', async () => {
    await open('/riders/report/short');
    expect(await screen.findByText('Профиль недоступен')).toBeOnTheScreen();
    expect(getViewer).not.toHaveBeenCalled();
  });

  it('гость по ссылке — гард ведёт на вход, запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    const router = await renderRouter(appRoutes, { initialUrl: `/riders/report/${PUBLIC_ID}` });
    await waitFor(() => expect(router.getPathname()).not.toBe(`/riders/report/${PUBLIC_ID}`));
    expect(getViewer).not.toHaveBeenCalled();
  });
});
