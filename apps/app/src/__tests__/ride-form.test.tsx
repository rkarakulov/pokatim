/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RideDetailForOrganizer, RideView } from '@pokatim/contracts';
import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import CancelRideRoute from '../app/rides/cancel/[id]';
import EditRideRoute from '../app/rides/edit/[id]';
import RideRoute from '../app/rides/[id]';
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
  viewer: {
    role: 'organizer',
    canJoin: false,
    canLeave: false,
    canManage: true,
    reported: false,
    canReport: false,
  },
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
    // свёрнуто до 8 городов: Минск — первым, дальше по алфавиту
    expect(screen.getByRole('button', { name: 'Минск' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Барановичи' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Гродно' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Все города' }));
    expect(screen.getByRole('button', { name: 'Гродно' })).toBeOnTheScreen();
    expect(screen.getByText('После публикации можно поделиться ссылкой.')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Без ограничения')).toBeOnTheScreen();
    expect(screen.getByLabelText('Как вас подписать')).toBeOnTheScreen();

    await fillValid();
    expect(screen.getByDisplayValue('10:00')).toBeOnTheScreen();
    // одиночный выбор города: состояние — у чипа (выбран один), без роли radiogroup поверх кнопок
    expect(screen.getByRole('button', { name: 'Минск' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Брест' })).not.toBeSelected();
    expect(screen.queryByRole('radiogroup')).toBeNull();
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

  it('время: «9:30» → «09:30», цифры — с двоеточием; подпись «Я» — не короче 2 символов', async () => {
    await open('/rides/new');
    await type('Время старта', '9:30');
    expect(screen.getByDisplayValue('09:30')).toBeOnTheScreen();
    await type('Время старта', '1015');
    expect(screen.getByDisplayValue('10:15')).toBeOnTheScreen();
    await type('Как вас подписать', 'Я');
    await fireEvent(screen.getByLabelText('Как вас подписать'), 'blur');
    expect(await screen.findByText('Не короче 2 символов.')).toBeOnTheScreen();
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
  it('поля из карточки; «Сохранить» — изменённые поля + version загрузки; затем карточка', async () => {
    const router = await open(`/rides/edit/${ID}`);
    expect(await screen.findByDisplayValue('Кофе-райд на море')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Катя')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('10:00')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('12')).toBeOnTheScreen();

    // фоновое обновление `me` (фокус) на экране правки не подменяет version формы
    getRideForViewer.mockResolvedValue({ ...organizerView, ride: { ...ride, version: 3 } });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(getRideForViewer).toHaveBeenCalledTimes(1);
    await type('Максимум участников (необязательно)', '20');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    // только изменённые поля + version загрузки формы: чужая правка других полей не затирается
    await waitFor(() =>
      expect(updateRide).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        limit: 20,
        version: 2,
      }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${ID}`));
  });

  it('очистка заполненных необязательных полей — в запросе null (подпись, описание, лимит)', async () => {
    await open(`/rides/edit/${ID}`);
    await screen.findByDisplayValue('Кофе-райд на море');
    await type('Как вас подписать', '');
    await type('Описание', '');
    await type('Максимум участников (необязательно)', '');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(updateRide).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        organizerName: null,
        description: null,
        limit: null,
        version: 2,
      }),
    );
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

  it('409 → «Обновить» → сбой загрузки: конфликт остаётся, ошибка с повтором, введённое не сброшено', async () => {
    updateRide.mockRejectedValue(new ApiHttpError(409, { code: 'CONFLICT', message: 'x' }));
    await open(`/rides/edit/${ID}`);
    await screen.findByDisplayValue('Кофе-райд на море');
    await type('Название', 'Моё новое название');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Райд изменили — обновите страницу')).toBeOnTheScreen();

    getRideForViewer.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await fireEvent.press(screen.getByText('Обновить'));
    await screen.findAllByText('Не удалось загрузить');
    // состояние запроса доходит до экрана через notifyManager позже промиса refetch — дать ему дойти
    await act(() => jest.advanceTimersByTimeAsync(100));
    // одно сообщение у «Обновить», без второго баннера фонового обновления с «Повторить»
    expect(screen.getAllByText('Не удалось загрузить')).toHaveLength(1);
    expect(screen.queryByText('Повторить')).toBeNull();
    expect(screen.getByText('Райд изменили — обновите страницу')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Моё новое название')).toBeOnTheScreen();

    getRideForViewer.mockResolvedValue({
      ...organizerView,
      ride: { ...ride, title: 'Новое название', version: 3 },
    });
    await fireEvent.press(screen.getByText('Обновить'));
    expect(await screen.findByDisplayValue('Новое название')).toBeOnTheScreen();
    expect(screen.queryByText('Райд изменили — обновите страницу')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Не удалось загрузить')).toBeNull());

    updateRide.mockResolvedValue({ ...organizerView, ride: { ...ride, version: 4 } });
    await type('Описание', 'Новое описание');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(updateRide).toHaveBeenLastCalledWith(liveSession.accessToken, ID, {
        description: 'Новое описание',
        version: 3,
      }),
    );
  });

  it('409 → сбой «Обновить» → повторное сохранение снова 409: прежней ошибки «Обновить» нет', async () => {
    updateRide.mockRejectedValue(new ApiHttpError(409, { code: 'CONFLICT', message: 'x' }));
    await open(`/rides/edit/${ID}`);
    await screen.findByDisplayValue('Кофе-райд на море');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Райд изменили — обновите страницу')).toBeOnTheScreen();
    getRideForViewer.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await fireEvent.press(screen.getByText('Обновить'));
    await screen.findAllByText('Не удалось загрузить');

    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(updateRide).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Райд изменили — обновите страницу')).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(100));
    // ошибка — только фонового обновления me (баннер с «Повторить»), не устаревшая у «Обновить»
    expect(screen.getAllByText('Не удалось загрузить')).toHaveLength(1);
    expect(screen.getByText('Повторить')).toBeOnTheScreen();
  });

  it('карточка под формой: её фоновое обновление me упало — баннер над формой, поля и version те же, «Повторить» работает', async () => {
    jest.mocked(api.getRide).mockResolvedValue(ride);
    // стек, как в приложении: карточка остаётся смонтированной под формой
    const router = await renderRouter(
      {
        _layout: () => <Stack screenOptions={{ headerShown: false }} />,
        ...routes,
        'rides/[id]': RideRoute,
      },
      { initialUrl: `/rides/${ID}`, wrapper: createQueryWrapper() },
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Изменить' }));
    expect(router.getPathname()).toBe(`/rides/edit/${ID}`);
    await screen.findByDisplayValue('Кофе-райд на море');
    expect(screen.queryAllByTestId('ride-detail', { includeHiddenElements: true })).toHaveLength(1);
    await type('Название', 'Моё название');

    // приложение свернули и вернули: карточка (тот же ключ me) обновляется и получает 500
    getRideForViewer.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Моё название')).toBeOnTheScreen();

    getRideForViewer.mockResolvedValue({ ...organizerView, ride: { ...ride, version: 3 } });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось загрузить')).toBeNull());
    expect(screen.getByDisplayValue('Моё название')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(updateRide).toHaveBeenCalledWith(liveSession.accessToken, ID, {
        title: 'Моё название',
        version: 2,
      }),
    );
  });

  it('не организатор (canManage false) — «Райд не найден»', async () => {
    getRideForViewer.mockResolvedValue({
      ride: { ...ride },
      viewer: {
        role: 'participant',
        canJoin: false,
        canLeave: true,
        canManage: false,
        reported: false,
        canReport: false,
      },
    });
    await open(`/rides/edit/${ID}`);
    expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
  });
});

describe('«Отменить райд» (AC5)', () => {
  it('причина обязательна; отмена — запрос с причиной, затем карточка', async () => {
    cancelRide.mockResolvedValue({
      ride: { ...ride, phase: 'cancelled', cancelReason: 'weather', version: 3 },
      viewer: {
        role: 'organizer',
        canJoin: false,
        canLeave: false,
        canManage: false,
        reported: false,
        canReport: false,
      },
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
