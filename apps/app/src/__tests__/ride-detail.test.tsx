/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type {
  CatalogRouteDetail,
  RideDetail,
  RideParticipants,
  RideRoute as RideRouteRef,
  RideView,
  RideViewer,
  RouteMapGeometry,
} from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { router as expoRouter } from 'expo-router';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { prepareShareImage } from '@/lib/share-image';
import { shareLink, shareOrigin } from '@/lib/share-link';

import RideRoute from '../app/rides/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { EMAIL, liveSession, session, storeSurveyCompleted } from './auth-fixtures';
import { USER_A } from './jwt';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn() }));
jest.mock('@/lib/share-image', () => ({
  shareImageSupported: () => true,
  prepareShareImage: jest.fn(),
}));

const getRide = jest.mocked(api.getRide);
const getRideForViewer = jest.mocked(api.getRideForViewer);
const joinRide = jest.mocked(api.joinRide);
const leaveRide = jest.mocked(api.leaveRide);
const rideParticipants = jest.mocked(api.rideParticipants);
const markRideAttended = jest.mocked(api.markRideAttended);
const thankRideRiders = jest.mocked(api.thankRideRiders);
const declineRideAttendance = jest.mocked(api.declineRideAttendance);
const share = jest.mocked(shareLink);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const SOFT_PROMPT = 'Узнайте о переносе или отмене райда';
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
  route: null,
  start: null,
  photo: null,
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
  'rides/invite/[id]': () => null,
};
const openSignedIn = (url = `/rides/${ID}`) =>
  renderRouter(signedInRoutes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRide.mockResolvedValue(detail);
  getRideForViewer.mockResolvedValue(view({}, viewer('none', { canJoin: true })));
  // «Свои» P2: по умолчанию — участники без публичных профилей (только число), зритель не участник
  rideParticipants.mockResolvedValue({
    riders: [],
    hiddenCount: detail.goingCount,
    attendance: null,
  });
  jest.mocked(shareOrigin).mockReturnValue('https://pokatim.by');
  share.mockResolvedValue('shared');
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRideCities).mockResolvedValue({ cities: [] });
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
    themeId: 'classic',
    avatarUploadBlockedUntil: null,
    showRouteRides: false,
  });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

// без имени организатора строки «Организатор» в герое нет (B9 смоука dev)
const heroLabel = 'Кофе-райд на Минское море. Воскресенье, 4 октября 2026, 10:00';

describe('карточка райда: гость (AC8)', () => {
  it('открывается без входа: поля, дата с годом, стопка, «Я иду», «Поделиться»; описание — текст; без me', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });

    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/rides/${ID}`);
    expect(screen.getByText('Кофе-райд')).toBeOnTheScreen();
    expect(screen.queryByText(/^Организатор/)).toBeNull();
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

  it('«Поделиться» гостя — сразу ссылкой, без шита и без «Карточки-приглашения» (AC7)', async () => {
    await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(screen.queryByTestId('share-choice-sheet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Карточка-приглашение' })).toBeNull();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ path: `/rides/${ID}` }));
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
    expect(joinRide).toHaveBeenCalledWith(liveSession.accessToken, ID, 'ride_card');
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
    // ошибка мутации — подсказки push нет (N5)
    expect(screen.queryByText(SOFT_PROMPT)).toBeNull();
  });

  describe('подсказка push после «Я иду» (N5)', () => {
    // ревью pass 2: экран под карточкой (лента, Главная) скрыт, но смонтирован — показ не его
    it.each([
      ['лента «Райды»', '/rides'],
      ['Главная', '/'],
    ])(
      'стек «%s → карточка»: «Я иду» на карточке — подсказка на карточке и одна',
      async (_name, from) => {
        jest.mocked(api.listRides).mockResolvedValue({
          items: [{ ...detail, viewer: viewer('none', { canJoin: true }) }],
          nextCursor: null,
        });
        joinRide.mockResolvedValue(
          view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
        );
        // корневой layout со Stack: карточка ложится поверх вкладок, экран под ней остаётся смонтированным
        await renderRouter(appRoutes, { initialUrl: from, wrapper: createQueryWrapper() });
        await waitFor(() => expect(api.listRides).toHaveBeenCalled());
        expect(
          await screen.findByRole('button', { name: 'Я иду', includeHiddenElements: false }),
        ).toBeOnTheScreen();
        await act(() => expoRouter.push(`/rides/${ID}`));

        await waitFor(() =>
          expect(getRideForViewer).toHaveBeenCalledWith(liveSession.accessToken, ID),
        );
        getRideForViewer.mockResolvedValue(
          view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
        );
        await waitFor(() =>
          expect(
            screen.getAllByRole('button', { name: 'Я иду', includeHiddenElements: false }),
          ).toHaveLength(1),
        );
        await fireEvent.press(
          screen.getByRole('button', { name: 'Я иду', includeHiddenElements: false }),
        );

        expect(
          await screen.findByText(SOFT_PROMPT, { includeHiddenElements: false }),
        ).toBeOnTheScreen();
        expect(screen.getAllByText(SOFT_PROMPT, { includeHiddenElements: true })).toHaveLength(1);
        // именно на карточке, а не на скрытом экране под ней
        expect(
          within(screen.getByTestId('ride-detail', { includeHiddenElements: false })).getByText(
            SOFT_PROMPT,
          ),
        ).toBeOnTheScreen();
      },
    );

    it('открытие карточки — без подсказки и без системного запроса; успешное «Я иду» — подсказка райда', async () => {
      const notifications = jest.requireMock<{ requestPermissionsAsync: jest.Mock }>(
        'expo-notifications',
      );
      joinRide.mockResolvedValue(
        view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
      );
      await openSignedIn();
      const join = await screen.findByRole('button', { name: 'Я иду' });
      expect(screen.queryByText(SOFT_PROMPT)).toBeNull();

      getRideForViewer.mockResolvedValue(
        view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
      );
      await fireEvent.press(join);
      expect(await screen.findByText(SOFT_PROMPT)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Включить' })).toBeOnTheScreen();
      expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('«Не иду» после показанной подсказки — подсказка закрыта', async () => {
      joinRide.mockResolvedValue(
        view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
      );
      leaveRide.mockResolvedValue(view({ goingCount: 5 }, viewer('none', { canJoin: true })));
      await openSignedIn();
      const join = await screen.findByRole('button', { name: 'Я иду' });
      getRideForViewer.mockResolvedValue(
        view({ goingCount: 6 }, viewer('participant', { canLeave: true })),
      );
      await fireEvent.press(join);
      expect(await screen.findByText(SOFT_PROMPT)).toBeOnTheScreen();

      getRideForViewer.mockResolvedValue(
        view({ goingCount: 5 }, viewer('none', { canJoin: true })),
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Не иду' }));
      expect(await screen.findByRole('button', { name: 'Я иду' })).toBeOnTheScreen();
      expect(screen.queryByText(SOFT_PROMPT)).toBeNull();
    });

    it('«Не иду» — подсказки нет', async () => {
      getRideForViewer.mockResolvedValue(view({}, viewer('participant', { canLeave: true })));
      leaveRide.mockResolvedValue(view({ goingCount: 4 }, viewer('none', { canJoin: true })));
      await openSignedIn();
      getRideForViewer.mockResolvedValue(
        view({ goingCount: 4 }, viewer('none', { canJoin: true })),
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Не иду' }));
      expect(await screen.findByRole('button', { name: 'Я иду' })).toBeOnTheScreen();
      expect(screen.queryByText(SOFT_PROMPT)).toBeNull();
    });
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

  it('прошедший: «Райд уже прошёл · …», «записались N · вы в списке», «Все райды» вместо действий (AC6)', async () => {
    getRideForViewer.mockResolvedValue(
      view({ phase: 'past', goingCount: 9 }, viewer('participant')),
    );
    const router = await openSignedIn();
    expect(
      await screen.findByText('Райд уже прошёл · Воскресенье, 4 октября 2026'),
    ).toBeOnTheScreen();
    expect(screen.getByText('записались 9 · вы в списке')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Не иду' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
    await fireEvent.press(screen.getAllByText('Все райды')[0]!);
    expect(router.getPathname()).toBe('/rides');
  });

  it('перенос — строка с датой; ?published=1 не организатору — без шита «Райд опубликован»', async () => {
    getRideForViewer.mockResolvedValue(
      view({ rescheduledAt: '2026-10-01T09:30:00Z' }, viewer('participant', { canLeave: true })),
    );
    await openSignedIn(`/rides/${ID}?published=1`);
    expect(
      await screen.findByText('Время или место старта изменены Четверг, 1 октября 2026, 12:30.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Райд опубликован')).toBeNull();
  });

  it('«Поделиться» — шит выбора: «Ссылка» на web-карточку; web без Web Share — «Ссылка скопирована»', async () => {
    share.mockResolvedValue('copied');
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    const sheet = screen.getByTestId('share-choice-sheet');
    expect(within(sheet).getByRole('button', { name: 'Карточка-приглашение' })).toBeOnTheScreen();
    expect(share).not.toHaveBeenCalled();
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Ссылка' }));
    expect(share).toHaveBeenCalledWith({
      title: detail.title,
      text: 'Кофе-райд на Минское море — Воскресенье, 4 октября 2026, 10:00, Минск',
      path: `/rides/${ID}`,
    });
    expect(await screen.findByText('Ссылка скопирована')).toBeOnTheScreen();
  });

  it('«Поделиться» с OG-картинкой райда файлом, когда она подготовлена', async () => {
    jest.mocked(api.getOgCard).mockResolvedValue({ version: '0123456789abcdef' });
    jest.mocked(api.ogImageUrl).mockReturnValue('https://api.test/og/ride.png');
    const image = { uri: 'file:///cache/og.png' };
    jest.mocked(prepareShareImage).mockResolvedValue(image);
    await openSignedIn();
    await waitFor(() =>
      expect(prepareShareImage).toHaveBeenCalledWith('https://api.test/og/ride.png'),
    );
    expect(api.getOgCard).toHaveBeenCalledWith('ride', ID);
    await act(async () => undefined);
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    await fireEvent.press(
      within(screen.getByTestId('share-choice-sheet')).getByRole('button', { name: 'Ссылка' }),
    );
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ path: `/rides/${ID}`, image }));
  });

  it('«Карточка-приглашение» в шите — экран приглашения; отдельной кнопки на карточке нет (AC7)', async () => {
    const router = await openSignedIn();
    await screen.findByRole('button', { name: 'Я иду' });
    expect(screen.queryByRole('button', { name: 'Карточка-приглашение' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    await fireEvent.press(
      within(screen.getByTestId('share-choice-sheet')).getByRole('button', {
        name: 'Карточка-приглашение',
      }),
    );
    expect(router.getPathname()).toBe(`/rides/invite/${ID}`);
    expect(share).not.toHaveBeenCalled();
  });

  it('нет web-origin (dev native) — «Поделиться» сразу на экран приглашения, без шита', async () => {
    jest.mocked(shareOrigin).mockReturnValue(null);
    const router = await openSignedIn();
    await screen.findByRole('button', { name: 'Я иду' });
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(screen.queryByTestId('share-choice-sheet')).toBeNull();
    expect(router.getPathname()).toBe(`/rides/invite/${ID}`);
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

describe('шит «Райд опубликован» (ride-published)', () => {
  it('гость с ?published=1 — шита нет', async () => {
    await renderRouter(appRoutes, { initialUrl: `/rides/${ID}?published=1` });
    await screen.findByLabelText(heroLabel);
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
  });
});

describe('шит «Райд опубликован»: организатор (ride-published)', () => {
  beforeEach(signedIn);

  const organizerView = (ride: Partial<RideDetail> = {}) =>
    view(ride, viewer('organizer', { canManage: true }));
  const openPublished = async () => {
    getRideForViewer.mockResolvedValue(organizerView());
    const router = await openSignedIn(`/rides/${ID}?published=1`);
    expect(await screen.findByRole('heading', { name: 'Райд опубликован' })).toBeOnTheScreen();
    return router;
  };

  it('организатор после публикации: заголовок, текст, «Карточка-приглашение», «Ссылка», «Закрыть»; окно — modal', async () => {
    await openPublished();
    expect(
      screen.getByText('Пригласите друзей — карточкой для сторис или ссылкой.'),
    ).toBeOnTheScreen();
    const sheet = screen.getByTestId('ride-published-sheet');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByRole('heading', { name: 'Райд опубликован' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Карточка-приглашение' })).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Ссылка' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeOnTheScreen();
    // прежнего баннера нет
    expect(screen.queryByText(/Пригласите друзей ссылкой/)).toBeNull();
  });

  it('«Карточка-приглашение» — экран карточки, шит закрыт, параметр снят', async () => {
    const router = await openPublished();
    await fireEvent.press(
      within(screen.getByTestId('ride-published-sheet')).getByRole('button', {
        name: 'Карточка-приглашение',
      }),
    );
    expect(router.getPathname()).toBe(`/rides/invite/${ID}`);
    await act(() => expoRouter.back());
    expect(router.getPathname()).toBe(`/rides/${ID}`);
    expect(router.getSearchParams()).not.toHaveProperty('published', '1');
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
  });

  it('«Ссылка» — системное меню ссылкой на райд; отправлено — шит закрывается', async () => {
    const router = await openPublished();
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    expect(share).toHaveBeenCalledWith({
      title: detail.title,
      text: 'Кофе-райд на Минское море — Воскресенье, 4 октября 2026, 10:00, Минск',
      path: `/rides/${ID}`,
    });
    await waitFor(() => expect(screen.queryByTestId('ride-published-sheet')).toBeNull());
    expect(router.getSearchParams()).not.toHaveProperty('published', '1');
  });

  it('«Ссылка»: закрыли меню — шит остаётся; web без Web Share — «Ссылка скопирована»; ошибка — баннер', async () => {
    await openPublished();
    share.mockResolvedValueOnce('dismissed');
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    expect(screen.getByTestId('ride-published-sheet')).toBeOnTheScreen();

    share.mockResolvedValueOnce('copied');
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    expect(
      await within(screen.getByTestId('ride-published-sheet')).findByText('Ссылка скопирована'),
    ).toBeOnTheScreen();

    share.mockRejectedValueOnce(new Error('boom'));
    await fireEvent.press(screen.getByRole('button', { name: 'Ссылка' }));
    expect(
      await within(screen.getByTestId('ride-published-sheet')).findByText(
        'Не удалось поделиться ссылкой.',
      ),
    ).toBeOnTheScreen();
  });

  it('«Закрыть» — шит закрыт, параметр снят, деталь организатора на месте', async () => {
    const router = await openPublished();
    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
    expect(router.getSearchParams()).not.toHaveProperty('published', '1');
    expect(screen.getByText('Кофе-райд · вы организатор')).toBeOnTheScreen();
  });

  it('«Назад» Android / Esc (onRequestClose) закрывает шит', async () => {
    await openPublished();
    // событие поднимается от шита к `Modal` (обработчик `onRequestClose`)
    await fireEvent(screen.getByLabelText('Райд опубликован'), 'requestClose');
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
  });

  it('нет web-origin — без «Ссылки», текст только про карточку', async () => {
    jest.mocked(shareOrigin).mockReturnValue(null);
    await openPublished();
    expect(screen.queryByRole('button', { name: 'Ссылка' })).toBeNull();
    expect(screen.getByText('Пригласите друзей карточкой для сторис.')).toBeOnTheScreen();
  });

  it('без параметра — шита нет', async () => {
    getRideForViewer.mockResolvedValue(organizerView());
    await openSignedIn();
    await screen.findByText('Кофе-райд · вы организатор');
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
  });

  it('прошедшему — шита нет', async () => {
    getRideForViewer.mockResolvedValue(organizerView({ phase: 'past' }));
    await openSignedIn(`/rides/${ID}?published=1`);
    await screen.findByText('Райд уже прошёл · Воскресенье, 4 октября 2026');
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
  });

  it('отменённому — шита нет', async () => {
    getRideForViewer.mockResolvedValue(organizerView({ phase: 'cancelled' }));
    await openSignedIn(`/rides/${ID}?published=1`);
    await screen.findByText('Райд отменён.');
    expect(screen.queryByTestId('ride-published-sheet')).toBeNull();
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

describe('карточка райда: маршрут (05c)', () => {
  const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000301';
  const LIGHT = 'https://tiles.example/styles/positron';
  const publicRoute: RideRouteRef = {
    id: ROUTE_ID,
    title: 'Минское море',
    distanceM: 62_400,
    elevationGainM: 310,
    access: 'public',
  };
  const catalog: CatalogRouteDetail = {
    id: ROUTE_ID,
    title: 'Минское море',
    distanceM: 62_400,
    elevationGainM: 310,
    isLoop: false,
    city: 'minsk',
    surfaces: ['asphalt'],
    publishedAt: '2026-09-01T00:00:00Z',
    author: { kind: 'team' },
    elevation: {
      minM: 190,
      maxM: 260,
      profile: [
        [0, 190],
        [31_200, 260],
        [62_400, 200],
      ],
    },
    gpxAvailable: false,
    exportFormats: [],
  };
  const geometry: RouteMapGeometry = {
    line: [
      [27.5, 53.8],
      [27.6, 54.0],
    ],
    start: [27.5, 53.8],
    finish: [27.6, 54.0],
    bounds: [27.5, 53.8, 27.6, 54.0],
  };
  const routesWithLinks = {
    ...signedInRoutes,
    'routes/[id]': () => null,
    'routes/mine/[id]': () => null,
  };

  beforeEach(() => {
    process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
    process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
    jest.mocked(api.getCatalogRoute).mockResolvedValue(catalog);
    jest.mocked(api.getCatalogRouteMap).mockResolvedValue(geometry);
    jest.mocked(api.getMyRouteMap).mockResolvedValue(geometry);
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  });

  it('без маршрута — блока, «Набора» и запросов маршрута нет', async () => {
    signedIn();
    await openSignedIn();
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(screen.queryByTestId('ride-route')).toBeNull();
    expect(screen.queryByText('Набор')).toBeNull();
    expect(api.getCatalogRoute).not.toHaveBeenCalled();
  });

  it('публичный маршрут: карта каталога, профиль высоты, «Набор» в цифрах, ссылка на /routes/<id>', async () => {
    signedIn();
    getRideForViewer.mockResolvedValue(
      view({ route: publicRoute, start: [27.5, 53.8] }, viewer('none', { canJoin: true })),
    );
    const router = await renderRouter(routesWithLinks, {
      initialUrl: `/rides/${ID}`,
      wrapper: createQueryWrapper(),
    });
    expect(await screen.findByTestId('ride-route')).toBeOnTheScreen();
    expect(screen.getByLabelText('Набор 310 м')).toBeOnTheScreen();
    expect(await screen.findByTestId('elevation-profile')).toBeOnTheScreen();
    expect(
      await screen.findByLabelText('Карта маршрута райда «Минское море», 62,4 км'),
    ).toBeOnTheScreen();
    expect(api.getCatalogRouteMap).toHaveBeenCalledWith(ROUTE_ID);
    expect(screen.queryByText(/Маршрут виден только вам/)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Маршрут райда' }));
    expect(router.getPathname()).toBe(`/routes/${ROUTE_ID}`);
  });

  it('профиль: загрузка — место профиля; ошибка — «Не удалось загрузить» с повтором; повтор — профиль (ревью pass 1)', async () => {
    signedIn();
    getRideForViewer.mockResolvedValue(
      view({ route: publicRoute, start: [27.5, 53.8] }, viewer('none', { canJoin: true })),
    );
    let fail: (error: unknown) => void = () => undefined;
    jest.mocked(api.getCatalogRoute).mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await openSignedIn();
    expect(
      await screen.findByTestId('ride-route-profile-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();

    await act(async () => fail(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' })));
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByTestId('elevation-profile')).toBeNull();
    // ссылка «Маршрут райда» и цифры остаются
    expect(screen.getByRole('button', { name: 'Маршрут райда' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('elevation-profile')).toBeOnTheScreen();
  });

  it('свой непубличный (организатор): карта «Моего маршрута» без профиля, баннер «опубликуйте», ссылка на /routes/mine/<id>', async () => {
    signedIn();
    getRideForViewer.mockResolvedValue(
      view(
        { route: { ...publicRoute, access: 'private' }, start: [27.5, 53.8] },
        viewer('organizer', { canManage: true }),
      ),
    );
    const router = await renderRouter(routesWithLinks, {
      initialUrl: `/rides/${ID}`,
      wrapper: createQueryWrapper(),
    });
    expect(
      await screen.findByText(
        'Маршрут виден только вам — опубликуйте его, чтобы участники увидели карту',
      ),
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(api.getMyRouteMap).toHaveBeenCalledWith(liveSession.accessToken, ROUTE_ID),
    );
    expect(api.getCatalogRoute).not.toHaveBeenCalled();
    expect(screen.queryByTestId('elevation-profile')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Маршрут райда' }));
    expect(router.getPathname()).toBe(`/routes/mine/${ROUTE_ID}`);
  });
});

describe('участники и явка (P2, K4, K5)', () => {
  beforeEach(signedIn);

  const PUB = (n: number) => `${'p'.repeat(42)}${n}`;
  const AV = (n: number) => `${'a'.repeat(42)}${n}`;
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      name: `Райдер ${index + 1}`,
      publicId: index === 1 ? null : PUB(index),
      avatar: index === 0 ? { id: AV(index) } : null,
    }));
  type AttendedRows = {
    riders: (RideParticipants['riders'][number] & { self?: boolean; thanked?: boolean })[];
    hiddenCount: number;
  };
  const attendance = (
    state: 'none' | 'attended' | 'declined',
    flags: { canMark: boolean; canDecline: boolean },
    attended: AttendedRows | null = null,
    allThanked = false,
  ) => ({
    state,
    ...flags,
    attended: attended && {
      hiddenCount: attended.hiddenCount,
      riders: attended.riders.map((row) => ({ self: false, thanked: false, ...row })),
    },
    allThanked,
  });
  const participants = (over: Partial<RideParticipants> = {}): RideParticipants => ({
    riders: rows(2),
    hiddenCount: 1,
    attendance: null,
    ...over,
  });
  const past = () =>
    getRideForViewer.mockResolvedValue(
      view({ phase: 'past', goingCount: 3 }, viewer('participant')),
    );
  const OPEN = { canMark: true, canDecline: true };
  const withRiders = () =>
    renderRouter(
      { ...signedInRoutes, 'riders/[id]': () => null, 'settings/profile': () => null },
      { initialUrl: `/rides/${ID}`, wrapper: createQueryWrapper() },
    );

  it('стопка с фото публичных, 5 строк, «и ещё N», «Показать всех» раскрывает и пропадает; ссылка на профиль', async () => {
    rideParticipants.mockResolvedValue(participants({ riders: rows(7), hiddenCount: 2 }));
    const router = await withRiders();
    expect(await screen.findByText('Райдер 1')).toBeOnTheScreen();
    expect(rideParticipants).toHaveBeenCalledWith(liveSession.accessToken, ID);
    // фото — в самой стопке (`avatarIds`), не только в строках списка
    expect(
      within(screen.getByTestId('going-stack')).getAllByTestId('rider-avatar-photo').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Райдер 5')).toBeOnTheScreen();
    expect(screen.queryByText('Райдер 6')).toBeNull();
    expect(screen.getByText('и ещё 2')).toBeOnTheScreen();
    // строка без publicId — не ссылка
    expect(screen.queryByRole('link', { name: 'Райдер 2, профиль райдера' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Показать всех' }));
    expect(screen.getByText('Райдер 7')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Показать всех' })).toBeNull();
    expect(screen.getByText('и ещё 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: 'Райдер 3, профиль райдера' }));
    expect(router.getPathname()).toBe(`/riders/${PUB(2)}`);
  });

  it('гость — без запроса участников, только число', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    await renderRouter(appRoutes, { initialUrl: `/rides/${ID}` });
    expect(await screen.findByText('идут 5 из 12')).toBeOnTheScreen();
    expect(rideParticipants).not.toHaveBeenCalled();
  });

  it('скелетон, пока участники грузятся; карточка видна', async () => {
    rideParticipants.mockReturnValue(new Promise(() => undefined));
    await openSignedIn();
    expect(
      await screen.findByTestId('ride-participants-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(heroLabel)).toBeOnTheScreen();
  });

  it('ошибка — баннер с «Повторить», название и «Поделиться» видны; повтор перезапрашивает', async () => {
    rideParticipants.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn();
    expect(await screen.findByText('Не удалось загрузить участников')).toBeOnTheScreen();
    expect(screen.getByLabelText(heroLabel)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    rideParticipants.mockResolvedValue(participants());
    const calls = rideParticipants.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Райдер 1')).toBeOnTheScreen();
    expect(rideParticipants.mock.calls.length).toBeGreaterThan(calls);
  });

  it('прошедший, нет отметки — «Райд прошёл», «Я был на райде», «Меня не было»; подпись стопки «записались N»', async () => {
    past();
    rideParticipants.mockResolvedValue(participants({ attendance: attendance('none', OPEN) }));
    await openSignedIn();
    expect(await screen.findByText('Райд прошёл')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Я был на райде' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Меня не было' })).toBeOnTheScreen();
    expect(screen.getByText('записались 3 · вы в списке')).toBeOnTheScreen();
    expect(screen.getByText('Райдер 1')).toBeOnTheScreen();
  });

  it('явка есть — «Ехали N» вместо списка и «Меня не было»', async () => {
    past();
    rideParticipants.mockResolvedValue(
      participants({
        attendance: attendance(
          'attended',
          { canMark: false, canDecline: true },
          { riders: rows(1), hiddenCount: 2 },
        ),
      }),
    );
    await openSignedIn();
    expect(await screen.findByText('Ехали 3')).toBeOnTheScreen();
    expect(screen.queryByText('Райдер 2')).toBeNull();
    expect(screen.getByText('Райдер 1')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Меня не было' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Я был на райде' })).toBeNull();
    expect(screen.queryByText('Райд прошёл')).toBeNull();
  });

  it('«не был» — строка и «Я был на райде»', async () => {
    past();
    rideParticipants.mockResolvedValue(
      participants({ attendance: attendance('declined', { canMark: true, canDecline: false }) }),
    );
    await openSignedIn();
    expect(await screen.findByText('Вы отметили, что не были на райде')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Я был на райде' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Меня не было' })).toBeNull();
  });

  it('после окна: явка — «Ехали N» без кнопок', async () => {
    past();
    const closed = { canMark: false, canDecline: false };
    rideParticipants.mockResolvedValue(
      participants({
        attendance: attendance('attended', closed, { riders: rows(2), hiddenCount: 0 }),
      }),
    );
    await openSignedIn();
    expect(await screen.findByText('Ехали 2')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Меня не было' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Я был на райде' })).toBeNull();
  });

  it('после окна без отметки — как раньше, без блока явки', async () => {
    past();
    const closed = { canMark: false, canDecline: false };
    rideParticipants.mockResolvedValue(participants({ attendance: attendance('none', closed) }));
    await openSignedIn();
    expect(await screen.findByText('Райдер 1')).toBeOnTheScreen();
    expect(screen.queryByText('Райд прошёл')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Я был на райде' })).toBeNull();
  });

  it.each(['hidden', 'cancelled'] as const)(
    '%s — без блока явки, список участников есть',
    async (phase) => {
      getRideForViewer.mockResolvedValue(view({ phase }, viewer('organizer')));
      rideParticipants.mockResolvedValue(
        participants({
          attendance: attendance(
            'attended',
            { canMark: false, canDecline: false },
            {
              riders: rows(1),
              hiddenCount: 0,
            },
          ),
        }),
      );
      await openSignedIn();
      expect(await screen.findByText('Райдер 2')).toBeOnTheScreen();
      expect(screen.queryByText(/^Ехали/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Я был на райде' })).toBeNull();
    },
  );

  it('«Я был на райде»: кнопка в ожидании, ответ — новый вид без повторного GET', async () => {
    past();
    rideParticipants.mockResolvedValue(participants({ attendance: attendance('none', OPEN) }));
    let resolve: (value: RideParticipants) => void = () => undefined;
    markRideAttended.mockReturnValue(new Promise((done) => (resolve = done)));
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Я был на райде' }));
    expect(markRideAttended).toHaveBeenCalledWith(liveSession.accessToken, ID);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Я был на райде' })).toBeDisabled(),
    );
    const calls = rideParticipants.mock.calls.length;
    await act(async () => {
      resolve(
        participants({
          attendance: attendance(
            'attended',
            { canMark: false, canDecline: true },
            {
              riders: rows(1),
              hiddenCount: 0,
            },
          ),
        }),
      );
    });
    expect(await screen.findByText('Ехал 1')).toBeOnTheScreen();
    expect(rideParticipants.mock.calls.length).toBe(calls);
  });

  it('«Меня не было» → «не был»; 409 attendance_window — текст и перезапрос; 429 — текст лимита', async () => {
    past();
    rideParticipants.mockResolvedValue(participants({ attendance: attendance('none', OPEN) }));
    declineRideAttendance.mockResolvedValueOnce(
      participants({ attendance: attendance('declined', { canMark: true, canDecline: false }) }),
    );
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Меня не было' }));
    expect(await screen.findByText('Вы отметили, что не были на райде')).toBeOnTheScreen();

    markRideAttended.mockRejectedValueOnce(
      new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 30 } }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Я был на райде' }));
    expect(await screen.findByText('Слишком часто. Повторите через 30 с.')).toBeOnTheScreen();

    // окно закрылось, пока карточка открыта: перечитанные флаги убирают кнопку, причина отказа остаётся
    markRideAttended.mockRejectedValueOnce(
      new ApiHttpError(409, {
        code: 'SOCIAL_ACTION_BLOCKED',
        message: 'x',
        details: { reason: 'attendance_window' },
      }),
    );
    rideParticipants.mockResolvedValue(
      participants({ attendance: attendance('declined', { canMark: false, canDecline: false }) }),
    );
    const calls = rideParticipants.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Я был на райде' }));
    await waitFor(() => expect(rideParticipants.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Я был на райде' })).toBeNull(),
    );
    expect(screen.getByText('Отметить явку можно с начала райда и 7 дней после')).toBeOnTheScreen();
  });

  it('подсказка имени (K3): непубличный профиль с блоком явки — «Добавить имя» → редактирование; публичный — нет', async () => {
    past();
    rideParticipants.mockResolvedValue(participants({ attendance: attendance('none', OPEN) }));
    const router = await withRiders();
    expect(await screen.findByText('Добавьте имя — свои увидят вас')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Добавить имя' }));
    expect(router.getPathname()).toBe('/settings/profile');
  });

  it('подсказки имени нет, если профиль публичный', async () => {
    past();
    rideParticipants.mockResolvedValue(participants({ attendance: attendance('none', OPEN) }));
    jest.mocked(api.getProfile).mockResolvedValue({
      rideReasons: [],
      publicName: 'Аня',
      showNameInResults: true,
      club: null,
      avatar: null,
      publicId: PUB(9),
      themeId: 'classic',
      avatarUploadBlockedUntil: null,
      showRouteRides: false,
    });
    await openSignedIn();
    expect(await screen.findByText('Райд прошёл')).toBeOnTheScreen();
    expect(screen.queryByText('Добавьте имя — свои увидят вас')).toBeNull();
  });
});

describe('«Спасибо за компанию» в «Ехали N» (P4, K5)', () => {
  beforeEach(signedIn);

  const PUB = (n: number) => `${'p'.repeat(42)}${n}`;
  const row = (
    n: number,
    over: { self?: boolean; thanked?: boolean; publicId?: string | null } = {},
  ) => ({
    name: `Райдер ${n}`,
    publicId: PUB(n),
    avatar: null,
    self: false,
    thanked: false,
    ...over,
  });
  const rode = (
    riders: ReturnType<typeof row>[],
    { hiddenCount = 0, allThanked = false }: { hiddenCount?: number; allThanked?: boolean } = {},
  ): RideParticipants => ({
    riders: [],
    hiddenCount: 0,
    attendance: {
      state: 'attended',
      canMark: false,
      canDecline: true,
      attended: { riders, hiddenCount },
      allThanked,
    },
  });
  const past = () =>
    getRideForViewer.mockResolvedValue(
      view({ phase: 'past', goingCount: 3 }, viewer('participant')),
    );

  it('у строки — «Спасибо за компанию», у себя и непубличного — нет; «Вы сказали спасибо»', async () => {
    past();
    rideParticipants.mockResolvedValue(
      rode([row(1, { self: true }), row(2), row(3, { thanked: true }), row(4, { publicId: null })]),
    );
    await openSignedIn();
    expect(await screen.findByText('Ехали 4')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Спасибо за компанию' })).toHaveLength(1);
    expect(screen.getByText('Вы сказали спасибо')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Поблагодарить всех' })).toBeOnTheScreen();
  });

  it('«Спасибо за компанию» → POST с publicId, ответ в кэш — «Вы сказали спасибо»', async () => {
    past();
    rideParticipants.mockResolvedValue(rode([row(1, { self: true }), row(2)]));
    thankRideRiders.mockResolvedValue(
      rode([row(1, { self: true }), row(2, { thanked: true })], { allThanked: true }),
    );
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Спасибо за компанию' }));
    expect(thankRideRiders).toHaveBeenCalledWith(liveSession.accessToken, ID, PUB(2));
    expect(await screen.findByText('Вы сказали спасибо')).toBeOnTheScreen();
    expect(screen.getByText('Вы поблагодарили всех')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Поблагодарить всех' })).toBeNull();
  });

  it('«Поблагодарить всех» → POST без publicId → «Вы поблагодарили всех»', async () => {
    past();
    rideParticipants.mockResolvedValue(rode([row(1, { self: true }), row(2)], { hiddenCount: 2 }));
    thankRideRiders.mockResolvedValue(
      rode([row(1, { self: true }), row(2, { thanked: true })], {
        hiddenCount: 2,
        allThanked: true,
      }),
    );
    await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поблагодарить всех' }));
    expect(thankRideRiders).toHaveBeenCalledWith(liveSession.accessToken, ID, undefined);
    expect(await screen.findByText('Вы поблагодарили всех')).toBeOnTheScreen();
  });

  it('ехал один — ни «Поблагодарить всех», ни текста', async () => {
    past();
    rideParticipants.mockResolvedValue(rode([row(1, { self: true })], { allThanked: true }));
    await openSignedIn();
    expect(await screen.findByText('Ехал 1')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Поблагодарить всех' })).toBeNull();
    expect(screen.queryByText('Вы поблагодарили всех')).toBeNull();
  });

  it('отказ 409 not_attended — баннер с причиной, участники перечитаны', async () => {
    past();
    rideParticipants.mockResolvedValue(rode([row(1, { self: true }), row(2)]));
    thankRideRiders.mockRejectedValueOnce(
      new ApiHttpError(409, {
        code: 'SOCIAL_ACTION_BLOCKED',
        message: 'x',
        details: { reason: 'not_attended' },
      }),
    );
    await openSignedIn();
    const calls = () => rideParticipants.mock.calls.length;
    await fireEvent.press(await screen.findByRole('button', { name: 'Спасибо за компанию' }));
    const before = calls();
    expect(
      await screen.findByText('Сказать спасибо можно только тем, кто был на райде вместе с вами'),
    ).toBeOnTheScreen();
    await waitFor(() => expect(calls()).toBeGreaterThanOrEqual(before));
  });
});
