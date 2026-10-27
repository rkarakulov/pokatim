/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RideDetail, RideView } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import ReportRideRoute from '../app/rides/report/[id]';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getRideForViewer = jest.mocked(api.getRideForViewer);
const reportRide = jest.mocked(api.reportRide);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000009';

const ride: RideDetail = {
  id: ID,
  title: 'Кофе-райд на море',
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 3,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  description: null,
};
const viewer = { role: 'none', canJoin: true, canLeave: false, canManage: false } as const;
const canReport: RideView = { ride, viewer: { ...viewer, reported: false, canReport: true } };
const reported: RideView = { ride, viewer: { ...viewer, reported: true, canReport: false } };

const routes = {
  'rides/report/[id]': ReportRideRoute,
  'rides/[id]': () => <Text>Карточка райда</Text>,
};
const open = () =>
  renderRouter(routes, { initialUrl: `/rides/report/${ID}`, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getRideForViewer.mockResolvedValue(canReport);
  reportRide.mockResolvedValue(reported);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('«Пожаловаться на райд» (05b, AC7)', () => {
  it('причина обязательна; комментарий; «Отправить» → баннер успеха и «К райду»', async () => {
    const router = await open();
    expect(await screen.findByText('Кофе-райд на море')).toBeOnTheScreen();
    const submit = screen.getByRole('button', { name: 'Отправить' });
    expect(submit).toBeDisabled();
    for (const reason of [
      'Спам или реклама',
      'Оскорбления или неприемлемый текст',
      'Опасно для участников',
      'Обман: такого райда нет',
      'Другое',
    ]) {
      expect(screen.getByText(reason)).toBeOnTheScreen();
    }

    await fireEvent.press(screen.getByText('Обман: такого райда нет'));
    await fireEvent.changeText(
      screen.getByLabelText('Комментарий — необязательно'),
      '  Такого места нет ',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(reportRide).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        reason: 'fake',
        comment: 'Такого места нет',
      }),
    );
    expect(await screen.findByText('Жалоба отправлена — команда проверит райд.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
    await fireEvent.press(screen.getByText('К райду'));
    expect(router.getPathname()).toBe(`/rides/${ID}`);
  });

  it('без комментария — null', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Спам или реклама'));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(reportRide).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        reason: 'spam',
        comment: null,
      }),
    );
  });

  it('ошибки: 429 — «Слишком часто…», сеть — «Нет соединения.», 404 — «Райд не найден»', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Спам или реклама'));

    reportRide.mockRejectedValueOnce(
      new ApiHttpError(429, {
        code: 'RATE_LIMITED',
        message: 'x',
        details: { retryAfterSec: 120 },
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Слишком часто. Повторите через 120 с.')).toBeOnTheScreen();

    reportRide.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Нет соединения.')).toBeOnTheScreen();

    reportRide.mockRejectedValueOnce(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
  });

  it('уже жаловался — «Вы пожаловались на этот райд», без формы', async () => {
    getRideForViewer.mockResolvedValue(reported);
    await open();
    expect(await screen.findByText('Вы пожаловались на этот райд')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });

  it('организатор (canReport false) — «На этот райд нельзя пожаловаться»', async () => {
    getRideForViewer.mockResolvedValue({
      ride,
      viewer: { ...viewer, reported: false, canReport: false },
    });
    await open();
    expect(await screen.findByText('На этот райд нельзя пожаловаться')).toBeOnTheScreen();
  });

  it('райда нет — «Райд не найден»', async () => {
    getRideForViewer.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await open();
    expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
  });
});
