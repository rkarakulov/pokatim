/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RideDetailForOrganizer, RideView } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import CancelRideRoute from '../app/rides/cancel/[id]';
import EditRideRoute from '../app/rides/edit/[id]';
import NewRideRoute from '../app/rides/new';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const createRide = jest.mocked(api.createRide);
const updateRide = jest.mocked(api.updateRide);
const cancelRide = jest.mocked(api.cancelRide);
const getRideForViewer = jest.mocked(api.getRideForViewer);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000007';

const ride: RideDetailForOrganizer = {
  id: ID,
  title: 'Кофе-райд на море',
  organizerName: 'Катя',
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
  description: 'Едем',
  version: 2,
};
const organizerView: RideView = {
  ride,
  viewer: { role: 'organizer', canJoin: false, canLeave: false, canManage: true },
};

const routes = {
  'rides/new': NewRideRoute,
  'rides/edit/[id]': EditRideRoute,
  'rides/cancel/[id]': CancelRideRoute,
  'rides/[id]': () => <Text>Карточка райда</Text>,
};
const open = (url: string) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getRideForViewer.mockResolvedValue(organizerView);
  createRide.mockResolvedValue(organizerView);
  updateRide.mockResolvedValue({ ...organizerView, ride: { ...ride, version: 3 } });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function pickDate(date: Date) {
  await fireEvent.press(screen.getByRole('button', { name: 'Дата' }));
  await fireEvent(screen.getByTestId('date-picker'), 'valueChange', { nativeEvent: {} }, date);
  await fireEvent.press(screen.getByRole('button', { name: 'Готово' }));
}

const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);

async function fillValid() {
  await type('Название', 'Кофе-райд на море');
  await pickDate(new Date(2026, 9, 4));
  await type('Время старта', '1000');
  await fireEvent.press(screen.getByRole('button', { name: 'Все города' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Минск' }));
  await type('Место старта', 'Парк Победы');
  await type('Дистанция, км', '42');
  await type('Темп от, км/ч', '22');
  await type('Темп до, км/ч', '24');
}

const publish = () => screen.getByRole('button', { name: 'Опубликовать' });

describe('форма «Новый райд» (S5, AC10)', () => {
  it('поля, подсказки; публикация — запрос с startsAt UTC по Минску; затем карточка с ?published=1', async () => {
    const router = await open('/rides/new');
    expect(screen.getByRole('header', { name: 'Новый райд' })).toBeOnTheScreen();
    // подсказки полей скрыты от скринридера (они в accessibilityHint поля)
    expect(
      screen.getByText('Видят все — выберите людное место, не домашний адрес.', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
    // свёрнуто до 8 городов по алфавиту
    expect(screen.getByRole('button', { name: 'Барановичи' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Минск' })).toBeNull();
    expect(screen.getByText('После публикации можно поделиться ссылкой.')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Без ограничения')).toBeOnTheScreen();
    expect(screen.getByLabelText('Как вас подписать')).toBeOnTheScreen();

    await fillValid();
    expect(screen.getByDisplayValue('10:00')).toBeOnTheScreen();
    await fireEvent.press(publish());

    await waitFor(() =>
      expect(createRide).toHaveBeenCalledWith(liveSession.accessToken, {
        title: 'Кофе-райд на море',
        organizerName: null,
        startsAt: '2026-10-04T07:00:00Z',
        cityCode: 'minsk',
        place: 'Парк Победы',
        distanceKm: 42,
        paceMinKmh: 22,
        paceMaxKmh: 24,
        limit: null,
        description: null,
      }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${ID}`));
    expect(router.getSearchParams()).toMatchObject({ published: '1' });
  });

  it('дата в прошлом — текст под датой, «Опубликовать» выключена с причиной', async () => {
    await open('/rides/new');
    await pickDate(new Date(2026, 8, 30));

    expect(
      await screen.findByText('Эта дата уже прошла — выберите дату в будущем.'),
    ).toBeOnTheScreen();
    expect(publish()).toBeDisabled();
    expect(screen.getByText('Исправьте дату, чтобы опубликовать райд')).toBeOnTheScreen();
  });

  it('клиентская схема: пустые обязательные, темп «от» > «до» — под полями, запроса нет', async () => {
    await open('/rides/new');
    await fireEvent.press(publish());
    expect((await screen.findAllByText('Заполните поле.')).length).toBeGreaterThan(0);

    await fillValid();
    await type('Темп от, км/ч', '30');
    await type('Темп до, км/ч', '20');
    await fireEvent.press(publish());
    expect(await screen.findByText('Темп «до» не может быть меньше темпа «от».')).toBeOnTheScreen();
    expect(createRide).not.toHaveBeenCalled();
  });

  it('ошибки полей сервера — под полями (startsAt — под «Дата»)', async () => {
    createRide.mockRejectedValue(
      new ApiHttpError(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { fields: [{ path: 'startsAt', code: 'RIDE_START_TOO_FAR' }] },
      }),
    );
    await open('/rides/new');
    await fillValid();
    await fireEvent.press(publish());
    expect(
      await screen.findByText('Райд можно создать не дальше чем на 60 дней вперёд.'),
    ).toBeOnTheScreen();
  });

  it('квота — баннер «У вас уже 5 будущих райдов…»; 429 — «Слишком часто…»; сеть — «Нет соединения.»', async () => {
    createRide.mockRejectedValueOnce(
      new ApiHttpError(409, {
        code: 'RIDE_QUOTA_EXCEEDED',
        message: 'x',
        details: { quota: 'organized', limit: 5 },
      }),
    );
    await open('/rides/new');
    await fillValid();
    await fireEvent.press(publish());
    expect(
      await screen.findByText('У вас уже 5 будущих райдов. Отмените один, чтобы создать новый.'),
    ).toBeOnTheScreen();

    createRide.mockRejectedValueOnce(
      new ApiHttpError(429, {
        code: 'RATE_LIMITED',
        message: 'x',
        details: { retryAfterSec: 120 },
      }),
    );
    await fireEvent.press(publish());
    expect(await screen.findByText('Слишком часто. Повторите через 120 с.')).toBeOnTheScreen();

    createRide.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')));
    await fireEvent.press(publish());
    expect(await screen.findByText('Нет соединения.')).toBeOnTheScreen();
  });
});

describe('«Изменить райд» (AC4)', () => {
  it('поля из карточки; «Сохранить» — все поля + version; затем карточка', async () => {
    const router = await open(`/rides/edit/${ID}`);
    expect(await screen.findByDisplayValue('Кофе-райд на море')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Катя')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('10:00')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('12')).toBeOnTheScreen();

    await type('Максимум участников (необязательно)', '20');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(updateRide).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        title: 'Кофе-райд на море',
        organizerName: 'Катя',
        startsAt: '2026-10-04T07:00:00Z',
        cityCode: 'minsk',
        place: 'Парк Победы',
        distanceKm: 42,
        paceMinKmh: 22,
        paceMaxKmh: 24,
        limit: 20,
        description: 'Едем',
        version: 2,
      }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${ID}`));
  });

  it('лимит ниже идущих — ошибка сервера под полем', async () => {
    updateRide.mockRejectedValue(
      new ApiHttpError(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { fields: [{ path: 'limit', code: 'RIDE_LIMIT_BELOW_GOING' }] },
      }),
    );
    await open(`/rides/edit/${ID}`);
    await screen.findByDisplayValue('Кофе-райд на море');
    await type('Максимум участников (необязательно)', '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(
      await screen.findByText('Максимум не может быть меньше числа идущих.'),
    ).toBeOnTheScreen();
  });

  it('409 CONFLICT — «Райд изменили» + «Обновить»: свежие поля с сервера', async () => {
    updateRide.mockRejectedValue(new ApiHttpError(409, { code: 'CONFLICT', message: 'x' }));
    await open(`/rides/edit/${ID}`);
    await screen.findByDisplayValue('Кофе-райд на море');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Райд изменили — обновите страницу')).toBeOnTheScreen();

    getRideForViewer.mockResolvedValue({
      ...organizerView,
      ride: { ...ride, title: 'Новое название', version: 3 },
    });
    await fireEvent.press(screen.getByText('Обновить'));
    expect(await screen.findByDisplayValue('Новое название')).toBeOnTheScreen();
    expect(screen.queryByText('Райд изменили — обновите страницу')).toBeNull();
  });

  it('не организатор (canManage false) — «Райд не найден»', async () => {
    getRideForViewer.mockResolvedValue({
      ride: { ...ride },
      viewer: { role: 'participant', canJoin: false, canLeave: true, canManage: false },
    });
    await open(`/rides/edit/${ID}`);
    expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
  });
});

describe('«Отменить райд» (AC5)', () => {
  it('причина обязательна; отмена — запрос с причиной, затем карточка', async () => {
    cancelRide.mockResolvedValue({
      ride: { ...ride, phase: 'cancelled', cancelReason: 'weather', version: 3 },
      viewer: { role: 'organizer', canJoin: false, canLeave: false, canManage: false },
    });
    const router = await open(`/rides/cancel/${ID}`);
    expect(
      await screen.findByText('Участники увидят отмену и причину в ленте и на карточке.'),
    ).toBeOnTheScreen();
    const submit = screen.getByRole('button', { name: 'Отменить райд' });
    expect(submit).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'плохая погода' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить райд' }));
    await waitFor(() =>
      expect(cancelRide).toHaveBeenCalledWith(liveSession.accessToken, ID, { reason: 'weather' }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${ID}`));
  });

  it('после старта — текст отказа', async () => {
    cancelRide.mockRejectedValue(
      new ApiHttpError(409, { code: 'RIDE_INVALID_STATE', message: 'x' }),
    );
    await open(`/rides/cancel/${ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'другое' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить райд' }));
    expect(await screen.findByText('Райд уже начался или отменён.')).toBeOnTheScreen();
  });
});
