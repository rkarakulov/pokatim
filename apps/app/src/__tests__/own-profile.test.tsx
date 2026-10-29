/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type {
  ProfileView,
  RiderRaceHistoryItem,
  RiderRaceHistoryPage,
  RiderRideHistoryPage,
  RiderStats,
} from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import OwnProfileRoute from '../app/profile';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const PUBLIC_ID = 'r'.repeat(43);
const RACE_ID = '0190a6f4-0000-7000-8000-000000000201';
const RACE_2 = '0190a6f4-0000-7000-8000-000000000202';
const RIDE_ID = '0190a6f4-0000-7000-8000-000000000301';

const never = () => new Promise<never>(() => undefined);
const profile = (overrides: Partial<ProfileView> = {}): ProfileView => ({
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  club: null,
  avatar: null,
  publicId: null,
  themeId: 'classic',
  ...overrides,
});
const stats = (overrides: Partial<RiderStats> = {}): RiderStats => ({
  activities: 12,
  distanceM: 345_678,
  elevationGainM: 900,
  races: 3,
  podiums: 1,
  finishes: 3,
  bestPlaces: [],
  ...overrides,
});
const raceItem = (id = RACE_ID, title = 'Гонка у озера'): RiderRaceHistoryItem => ({
  race: {
    id,
    title,
    windowStartsAt: '2026-05-01T06:00:00.000Z',
    windowEndsAt: '2026-05-03T18:00:00.000Z',
    status: 'published',
  },
  result: { status: 'final', place: 6, tied: true, elapsedSec: 3725, unranked: null },
  groupKey: 'overall',
  tier: 'start',
});
const racePage = (
  items: RiderRaceHistoryItem[],
  nextCursor: string | null = null,
): RiderRaceHistoryPage => ({ items, nextCursor });
const ridePage: RiderRideHistoryPage = {
  items: [
    {
      id: RIDE_ID,
      title: 'Утренний кофе',
      startsAt: '2026-05-02T06:00:00.000Z',
      distanceKm: 42,
      role: 'participant',
    },
  ],
  nextCursor: null,
};
const failure = () => new ApiHttpError(500, { code: 'INTERNAL', message: 'x' });

const getProfile = jest.mocked(api.getProfile);
const getStats = jest.mocked(api.getProfileStats);
const listRaces = jest.mocked(api.listProfileRaces);
const listRides = jest.mocked(api.listProfileRides);

const stub = () => null;
const openProfile = () =>
  renderRouter(
    {
      profile: OwnProfileRoute,
      'settings/profile': stub,
      'riders/[id]': stub,
      'races/[id]': stub,
      'rides/[id]': stub,
      '(tabs)/races': stub,
    },
    { initialUrl: '/profile', wrapper: createQueryWrapper() },
  );
const history = () => within(screen.getByTestId('profile-history-races'));

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  getProfile.mockResolvedValue(profile());
  getStats.mockResolvedValue(stats());
  listRaces.mockResolvedValue(racePage([raceItem()]));
  listRides.mockResolvedValue(ridePage);
  jest.mocked(api.avatarUrl).mockImplementation((id) => `https://api.test/v1/avatars/${id}`);
  // блок «Сезон» — сезонов нет, блок скрыт (сам блок — `profile-season-block.test.tsx`)
  jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: null });
  jest.mocked(api.listSeasons).mockResolvedValue({ items: [] });
  // блок «Достижения» — пусто, блока нет (сам блок — `achievements-blocks.test.tsx`)
  jest.mocked(api.listAchievements).mockResolvedValue({ items: [] });
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('свой профиль /profile: шапка (rider-profile, AC12)', () => {
  it('«Назад» сразу; шапка, статистика и история — скелетоны', async () => {
    getProfile.mockReturnValue(never());
    getStats.mockReturnValue(never());
    listRaces.mockReturnValue(never());
    await openProfile();

    expect(await screen.findByRole('button', { name: 'Назад' })).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Имя не указано')).toBeNull();
    expect(getProfile).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', failure(), 'Не удалось загрузить'],
  ])('ошибка шапки (%s) — «%s» с повтором', async (_case, error, title) => {
    getProfile.mockRejectedValueOnce(error);
    getStats.mockReturnValue(never());
    listRaces.mockReturnValue(never());
    await openProfile();
    expect(await screen.findByText(title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Имя не указано')).toBeOnTheScreen();
  });

  it('без имени — «Имя не указано», личная линия без текста; без publicId — подсказка вместо ссылки', async () => {
    await openProfile();
    expect(await screen.findByRole('header', { name: 'Имя не указано' })).toBeOnTheScreen();
    expect(within(screen.getByTestId('profile-rule')).queryByText(/.+/)).toBeNull();
    expect(
      screen.getByText(
        'Другие увидят профиль, когда вы укажете имя и включите показ в результатах',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Как вас видят другие' })).toBeNull();
    expect(screen.getByRole('image', { name: 'Фото не выбрано' })).toBeOnTheScreen();
  });

  it('имя, клуб в личной линии, фото; «Как вас видят другие» → /riders/<publicId>', async () => {
    getProfile.mockResolvedValue(
      profile({
        publicName: 'Анна К.',
        showNameInResults: true,
        club: 'Velo Club Minsk',
        avatar: { id: PUBLIC_ID },
        publicId: PUBLIC_ID,
      }),
    );
    const router = await openProfile();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('profile-rule')).getByText('Velo Club Minsk'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('rider-avatar-photo')).toHaveProp('source', {
      uri: `https://api.test/v1/avatars/${PUBLIC_ID}`,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Как вас видят другие' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/riders/${PUBLIC_ID}`));
  });

  it('«Редактировать профиль» → /settings/profile', async () => {
    const router = await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Редактировать профиль' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/profile'));
  });
});

describe('свой профиль /profile: статистика (AC12)', () => {
  it('ячейки: заезды, км, набор, в зачёте, подиумы, лучшее место; «Лучшие места» → гонка', async () => {
    getStats.mockResolvedValue(
      stats({
        bestPlaces: [
          {
            race: { id: RACE_2, title: 'Кубок', windowStartsAt: '2026-06-01T06:00:00.000Z' },
            place: 2,
            tied: false,
            groupKey: 'overall',
          },
        ],
      }),
    );
    const router = await openProfile();
    const block = within(await screen.findByTestId('stat-block'));
    expect(block.getByLabelText('Заезды 12')).toBeOnTheScreen();
    expect(block.getByLabelText('Дистанция 345,7 км')).toBeOnTheScreen();
    expect(block.getByLabelText('Набор 900 м')).toBeOnTheScreen();
    expect(block.getByLabelText('В зачёте 3')).toBeOnTheScreen();
    // rider-links-in-tables: финиши — в зачёте и без места
    expect(block.getByLabelText('Финиши 3')).toBeOnTheScreen();
    expect(block.getByLabelText('Подиумы 1')).toBeOnTheScreen();
    expect(block.getByLabelText('Лучшее место 2')).toBeOnTheScreen();

    expect(screen.getByRole('header', { name: 'Лучшие места' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Кубок, / }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_2}`));
  });

  it('нули — данные (не пустое состояние); лучшего места нет — «—»', async () => {
    getStats.mockResolvedValue(
      stats({ activities: 0, distanceM: 0, elevationGainM: 0, races: 0, podiums: 0 }),
    );
    await openProfile();
    expect(await screen.findByLabelText('Лучшее место —')).toBeOnTheScreen();
    expect(screen.getByLabelText('Заезды 0')).toBeOnTheScreen();
    expect(screen.queryByText('Лучшие места')).toBeNull();
  });

  it('ошибка статистики — «Не удалось загрузить» с повтором в блоке', async () => {
    getStats.mockRejectedValueOnce(failure());
    await openProfile();
    const block = within(await screen.findByTestId('profile-stats'));
    expect(await block.findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(block.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText('Заезды 12')).toBeOnTheScreen();
  });
});

describe('свой профиль /profile: история (AC13)', () => {
  it('«Гонки» по умолчанию: место «=6», плашка, время; нажатие → /races/<id>; «Райды» не запрашиваются', async () => {
    const router = await openProfile();
    expect(await screen.findByRole('header', { name: 'История' })).toBeOnTheScreen();
    expect(await history().findByText('=6')).toBeOnTheScreen();
    expect(history().getByText('Финальный')).toBeOnTheScreen();
    expect(history().getByText('1:02:05')).toBeOnTheScreen();
    expect(history().getByText('START · Общий зачёт')).toBeOnTheScreen();
    expect(listRaces).toHaveBeenCalledWith(liveSession.accessToken, { limit: 10 });
    expect(listRides).not.toHaveBeenCalled();

    await fireEvent.press(history().getByRole('button', { name: /^Гонка у озера, / }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });

  it('пусто — «Вы ещё не участвовали в гонках» и «Все гонки»', async () => {
    listRaces.mockResolvedValue(racePage([]));
    const router = await openProfile();
    expect(await screen.findByText('Вы ещё не участвовали в гонках')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Все гонки' }));
    await waitFor(() => expect(router.getPathname()).toBe('/races'));
  });

  it('ошибка без данных — баннер с текстом блока и повтором; без сети — «Нет соединения» с тем же текстом', async () => {
    listRaces.mockRejectedValueOnce(new ApiNetworkError(new TypeError('Network request failed')));
    listRaces.mockRejectedValueOnce(failure());
    await openProfile();
    const races = within(await screen.findByTestId('profile-history-races'));
    expect(await races.findByText('Нет соединения')).toBeOnTheScreen();
    expect(races.getByText('Не удалось загрузить историю')).toBeOnTheScreen();
    await fireEvent.press(races.getByRole('button', { name: 'Повторить' }));
    expect(await races.findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(races.getByRole('button', { name: 'Повторить' }));
    expect(await history().findByText('=6')).toBeOnTheScreen();
  });

  it('«Показать ещё» — следующая страница по курсору; ошибка догрузки — баннер с повтором', async () => {
    listRaces
      .mockResolvedValueOnce(racePage([raceItem()], 'c1'))
      .mockRejectedValueOnce(failure())
      .mockResolvedValueOnce(racePage([raceItem(RACE_2, 'Кубок осени')]));
    await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Показать ещё' }));
    await waitFor(() =>
      expect(listRaces).toHaveBeenLastCalledWith(liveSession.accessToken, {
        limit: 10,
        cursor: 'c1',
      }),
    );
    expect(await history().findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(history().getByText('Гонка у озера')).toBeOnTheScreen();

    await fireEvent.press(history().getByRole('button', { name: 'Повторить' }));
    expect(await history().findByText('Кубок осени')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('«Райды» — запрос только после переключения; строка: дата, км, роль; → /rides/<id>', async () => {
    const router = await openProfile();
    await history().findByText('=6');
    expect(listRides).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('tab', { name: 'Райды' }));
    const rides = within(await screen.findByTestId('profile-history-rides'));
    expect(await rides.findByText('Утренний кофе')).toBeOnTheScreen();
    expect(rides.getByText(/ · 42 км · Участник$/)).toBeOnTheScreen();
    expect(listRides).toHaveBeenCalledWith(liveSession.accessToken, { limit: 10 });

    await fireEvent.press(rides.getByRole('button', { name: /^Утренний кофе · / }));
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${RIDE_ID}`));
  });

  it('«Райды» пусто — «Прошедших райдов пока нет»', async () => {
    listRides.mockResolvedValue({ items: [], nextCursor: null });
    await openProfile();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Райды' }));
    expect(await screen.findByText('Прошедших райдов пока нет')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Все райды' })).toBeOnTheScreen();
  });
});
