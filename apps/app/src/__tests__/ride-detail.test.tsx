/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RideDetail, RideView, RideViewer } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { shareLink, shareOrigin } from '@/lib/share-link';

import RideRoute from '../app/rides/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { EMAIL, liveSession, session, storeSurveyCompleted } from './auth-fixtures';
import { USER_A } from './jwt';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn() }));
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getRide = jest.mocked(api.getRide);
const getRideForViewer = jest.mocked(api.getRideForViewer);
const joinRide = jest.mocked(api.joinRide);
const leaveRide = jest.mocked(api.leaveRide);
const share = jest.mocked(shareLink);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000005';

const detail: RideDetail = {
  id: ID,
  title: 'Кофе-райд на Минское море',
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  description: 'Едем спокойно.\nhttps://example.by — не ссылка.',
};
const viewer = (role: RideViewer['role'], rights: Partial<RideViewer> = {}): RideViewer => ({
  role,
  canJoin: false,
  canLeave: false,
  canManage: false,
  reported: false,
  canReport: false,
  ...rights,
});
const view = (ride: Partial<RideDetail>, who: RideViewer): RideView => ({
  ride: { ...detail, ...ride },
  viewer: who,
});

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const signedInRoutes = {
  ...tabRoutes,
  'rides/[id]': RideRoute,
  'rides/edit/[id]': () => null,
  'rides/cancel/[id]': () => null,
  'rides/report/[id]': () => null,
};
const openSignedIn = (url = `/rides/${ID}`) =>
  renderRouter(signedInRoutes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRide.mockResolvedValue(detail);
  getRideForViewer.mockResolvedValue(view({}, viewer('none', { canJoin: true })));
  jest.mocked(shareOrigin).mockReturnValue('https://pokatim.by');
  share.mockResolvedValue('shared');
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRideCities).mockResolvedValue({ cities: [] });
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest
    .mocked(api.getProfile)
    .mockResolvedValue({ rideReasons: [], publicName: null, showNameInResults: false });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const heroLabel = 'Организатор. Кофе-райд на Минское море. Воскресенье, 4 октября 2026, 10:00';

describe('карточка райда: гость (AC8)', () => {
  it('открывается без входа: поля, дата с годом, стопка, «Я иду», «Поделиться»; описание — текст; без me', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });

    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/rides/${ID}`);
    expect(screen.getByText('Кофе-райд')).toBeOnTheScreen();
    expect(screen.getByText('Старт: Минск, Парк Победы')).toBeOnTheScreen();
    expect(screen.getByLabelText('Дистанция 42 км')).toBeOnTheScreen();
    expect(screen.getByLabelText('Темп 22–24 км/ч')).toBeOnTheScreen();
    expect(screen.getByText('идут 5 из 12')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Я иду' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(screen.getByText('Об этом райде')).toBeOnTheScreen();
    expect(screen.getByText(detail.description!)).toHaveProp('selectable', true);
    expect(getRideForViewer).not.toHaveBeenCalled();
    for (const hidden of ['Набор', 'Изменить', 'Не иду', /рядом/, /в других разделах/]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
  });

  it('«Я иду» гостя → «Вход»; после входа — снова карточка райда (возврат, Q13); запись — не автоматически', async () => {
    storeSurveyCompleted();
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session });
    jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
    const router = await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });

    await fireEvent.press(await screen.findByRole('button', { name: 'Я иду' }));
    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');

    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${ID}`));
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(joinRide).not.toHaveBeenCalled();
  });

  it('«Я иду» гостя → вход → шаг онбординга «Позже» → снова карточка райда, а не Главная (возврат, Q13)', async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue({ status: 'granted' } as Location.LocationPermissionResponse);
    storeSurveyCompleted(USER_A, { devicesStepCompleted: false });
    jest
      .mocked(api.getOnboardingStatus)
      .mockResolvedValue({ surveyCompleted: true, devicesStepCompleted: false });
    jest.mocked(api.listDevices).mockResolvedValue({ items: [] });
    jest
      .mocked(api.completeDevicesStep)
      .mockResolvedValue({ surveyCompleted: true, devicesStepCompleted: true });
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session });
    jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
    const router = await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });

    await fireEvent.press(await screen.findByRole('button', { name: 'Я иду' }));
    await fireEvent.changeText(await screen.findByLabelText('E-mail'), EMAIL);
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Позже' }));

    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${ID}`));
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    // возврат не перебит гардом шагов онбординга (redirectTo «/»)
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(router.getPathname()).toBe(`/rides/${ID}`);
  });

  it('404 — «Райд не найден» + «Все райды»; невалидный id — без запроса', async () => {
    getRide.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });
    expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
    expect(screen.getByText('Все райды')).toBeOnTheScreen();

    getRide.mockClear();
    await renderRouter(appRoutes, { initialUrl: '/rides/not-a-uuid' });
    expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
    expect(getRide).not.toHaveBeenCalled();
  });
});

describe('карточка райда: вошедший (AC1–AC6)', () => {
  beforeEach(signedIn);

  it('состояние зрителя — me с Bearer; «Я иду» → «Вы идёте · …» и «Не иду»; «Не иду» → снова «Я иду»', async () => {
    joinRide.mockResolvedValue(view({ goingCount: 6 }, viewer('participant', { canLeave: true })));
    leaveRide.mockResolvedValue(view({ goingCount: 5 }, viewer('none', { canJoin: true })));
    await openSignedIn();

    const join = await screen.findByRole('button', { name: 'Я иду' });
    // после мутации `me` перезапрашивается — сервер уже знает отметку
    getRideForViewer.mockResolvedValue(
      view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
    );
    await fireEvent.press(join);
    expect(getRideForViewer).toHaveBeenCalledWith(liveSession.accessToken, ID);
    expect(joinRide).toHaveBeenCalledWith(liveSession.accessToken, ID);
    expect(
      await screen.findByText('Вы идёте · Воскресенье, 4 октября 2026, 10:00'),
    ).toBeOnTheScreen();
    expect(screen.getByText('идут 6 из 12 · вы в списке')).toBeOnTheScreen();

    getRideForViewer.mockResolvedValue(view({ goingCount: 5 }, viewer('none', { canJoin: true })));
    await fireEvent.press(screen.getByRole('button', { name: 'Не иду' }));
    expect(leaveRide).toHaveBeenCalledWith(liveSession.accessToken, ID);
    expect(await screen.findByRole('button', { name: 'Я иду' })).toBeOnTheScreen();
  });

  it('организатор: метка «· вы организатор», подпись (D2), «Изменить», «Отменить райд», «Поделиться»', async () => {
    getRideForViewer.mockResolvedValue({
      ride: { ...detail, goingCount: 1, organizerName: 'Катя Л.', version: 2 },
      viewer: viewer('organizer', { canManage: true }),
    });
    const router = await openSignedIn();

    expect(await screen.findByText('Кофе-райд · вы организатор')).toBeOnTheScreen();
    expect(screen.getByText('Организатор: Катя Л.')).toBeOnTheScreen();
    expect(screen.getByText('идёт 1 из 12 · вы')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Я иду' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
    expect(router.getPathname()).toBe(`/rides/edit/${ID}`);
  });

  it('«Отменить райд» организатора → экран отмены', async () => {
    getRideForViewer.mockResolvedValue({
      ride: { ...detail, version: 0 },
      viewer: viewer('organizer', { canManage: true }),
    });
    const router = await openSignedIn();
    await fireEvent.press(await screen.findByText('Отменить райд'));
    expect(router.getPathname()).toBe(`/rides/cancel/${ID}`);
  });

  it('полный: баннер «Мест нет — все 12 мест заняты.» над выключенной «Я иду»; RIDE_FULL при гонке — текст у действия', async () => {
    getRideForViewer.mockResolvedValue(view({ goingCount: 12, full: true }, viewer('none')));
    await openSignedIn();
    expect(await screen.findByText('Мест нет — все 12 мест заняты.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Я иду' })).toBeDisabled();
  });

  it('«Я иду» отклонён сервером (RIDE_FULL) — текст отказа у кнопки', async () => {
    joinRide.mockRejectedValue(new ApiHttpError(409, { code: 'RIDE_FULL', message: 'x' }));
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Я иду' }));
    expect(await screen.findByText('Мест нет — все 12 мест заняты.')).toBeOnTheScreen();
  });

  it('отменённый: баннер с причиной, без «Я иду» и «Поделиться» (AC5)', async () => {
    getRideForViewer.mockResolvedValue(
      view({ phase: 'cancelled', cancelReason: 'weather' }, viewer('participant')),
    );
    await openSignedIn();
    expect(await screen.findByText('Райд отменён. Причина: плохая погода.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Я иду' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
  });

  it('прошедший: «Райд уже прошёл · …», «ехали N · вы в списке», «Все райды» вместо действий (AC6)', async () => {
    getRideForViewer.mockResolvedValue(
      view({ phase: 'past', goingCount: 9 }, viewer('participant')),
    );
    const router = await openSignedIn();
    expect(
      await screen.findByText('Райд уже прошёл · Воскресенье, 4 октября 2026'),
    ).toBeOnTheScreen();
    expect(screen.getByText('ехали 9 · вы в списке')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Не иду' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
    await fireEvent.press(screen.getAllByText('Все райды')[0]!);
    expect(router.getPathname()).toBe('/rides');
  });

  it('перенос — строка с датой; сразу после публикации — баннер «Райд опубликован»', async () => {
    getRideForViewer.mockResolvedValue(
      view({ rescheduledAt: '2026-10-01T09:30:00Z' }, viewer('participant', { canLeave: true })),
    );
    await openSignedIn(`/rides/${ID}?published=1`);
    expect(
      await screen.findByText('Время или место старта изменены Четверг, 1 октября 2026, 12:30.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Райд опубликован. Пригласите друзей ссылкой.')).toBeOnTheScreen();
  });

  it('«Поделиться» — ссылка на web-карточку; web без Web Share — «Ссылка скопирована»', async () => {
    share.mockResolvedValue('copied');
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(share).toHaveBeenCalledWith({
      title: detail.title,
      text: 'Кофе-райд на Минское море — Воскресенье, 4 октября 2026, 10:00, Минск',
      path: `/rides/${ID}`,
    });
    expect(await screen.findByText('Ссылка скопирована')).toBeOnTheScreen();
  });

  it('нет web-origin (dev native) — кнопки «Поделиться» нет', async () => {
    jest.mocked(shareOrigin).mockReturnValue(null);
    await openSignedIn();
    await screen.findByRole('button', { name: 'Я иду' });
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
  });

  it("'unknown' в фазе, роли, городе и причине — нейтрально, без действия, экран не падает (AC-T7)", async () => {
    getRideForViewer.mockResolvedValue(
      view({ phase: 'unknown', city: 'unknown', cancelReason: 'unknown' }, viewer('unknown')),
    );
    await openSignedIn();
    expect(await screen.findByText('Старт: Парк Победы')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Я иду' })).toBeNull();
    expect(screen.queryByText(/Райд отменён/)).toBeNull();
  });

  it('публичные данные есть, а состояние зрителя (me) — 500: карточка остаётся, баннер с повтором; повтор — «Я иду»', async () => {
    getRideForViewer.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await openSignedIn();
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Я иду' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Я иду' })).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('«Я иду» сверх квоты отметок — текст квоты у кнопки', async () => {
    joinRide.mockRejectedValue(
      new ApiHttpError(409, {
        code: 'RIDE_QUOTA_EXCEEDED',
        message: 'x',
        details: { quota: 'joined', limit: 20 },
      }),
    );
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Я иду' }));
    expect(
      await screen.findByText(
        'У вас уже 20 будущих отметок «Я иду». Снимите одну, чтобы записаться.',
      ),
    ).toBeOnTheScreen();
  });

  it('сервер недоступен — «Не удалось загрузить» + «Повторить»', async () => {
    getRide.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    getRideForViewer.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    getRideForViewer.mockResolvedValue(view({}, viewer('none', { canJoin: true })));
    await act(async () => {
      await fireEvent.press(screen.getByText('Повторить'));
    });
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
  });
});

describe('карточка райда: жалоба и скрытый (05b, AC7)', () => {
  it('гость — без «Пожаловаться»', async () => {
    await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(screen.queryByText('Пожаловаться')).toBeNull();
  });

  describe('вошедший', () => {
    beforeEach(signedIn);

    it('canReport — «Пожаловаться» ведёт на экран жалобы', async () => {
      getRideForViewer.mockResolvedValue(
        view({}, viewer('none', { canJoin: true, canReport: true })),
      );
      const router = await openSignedIn();
      await fireEvent.press(await screen.findByText('Пожаловаться'));
      expect(router.getPathname()).toBe(`/rides/report/${ID}`);
    });

    it('уже пожаловался — строка «Вы пожаловались на этот райд» вместо действия', async () => {
      getRideForViewer.mockResolvedValue(
        view({}, viewer('participant', { canLeave: true, reported: true })),
      );
      await openSignedIn();
      expect(await screen.findByText('Вы пожаловались на этот райд')).toBeOnTheScreen();
      expect(screen.queryByText('Пожаловаться')).toBeNull();
    });

    it('организатор (canReport false) — без «Пожаловаться»', async () => {
      getRideForViewer.mockResolvedValue({
        ride: { ...detail, version: 0 },
        viewer: viewer('organizer', { canManage: true }),
      });
      await openSignedIn();
      expect(await screen.findByText('Кофе-райд · вы организатор')).toBeOnTheScreen();
      expect(screen.queryByText('Пожаловаться')).toBeNull();
    });

    it('скрытый: публично 404, организатору — me с баннером, без действий', async () => {
      getRide.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
      getRideForViewer.mockResolvedValue({
        ride: { ...detail, phase: 'hidden', version: 3 },
        viewer: viewer('organizer'),
      });
      await openSignedIn();
      expect(
        await screen.findByText('Райд скрыт модератором. Другие райдеры его не видят'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText(heroLabel)).toBeOnTheScreen();
      for (const action of ['Изменить', 'Отменить райд', 'Поделиться', 'Я иду', 'Пожаловаться']) {
        expect(screen.queryByText(action)).toBeNull();
      }
    });

    it('скрытый не организатору — «Райд не найден»', async () => {
      getRide.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
      getRideForViewer.mockRejectedValue(
        new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }),
      );
      await openSignedIn();
      expect(await screen.findByText('Райд не найден')).toBeOnTheScreen();
    });
  });
});
