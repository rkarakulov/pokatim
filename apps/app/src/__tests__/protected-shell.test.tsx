import { ApiNetworkError } from '@pokatim/api-client';
import type { ComponentType } from 'react';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import AchievementRoute from '../app/achievements/[code]';
import AchievementFlashRoute from '../app/achievements/flash';
import AchievementStoryRoute from '../app/achievements/story/[code]';
import NotificationsScreen from '../app/notifications';
import OwnProfileRoute from '../app/profile';
import SocialRoute from '../app/social';
import DisputeResponseRoute from '../app/races/dispute-response/[id]/[disputeId]';
import FileDisputeRoute from '../app/races/dispute/[id]/[entryId]';
import RacePickRoute from '../app/races/pick/[id]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import StoryCardRoute from '../app/races/story/[id]';
import ReportRiderRoute from '../app/riders/report/[id]';
import CancelRideRoute from '../app/rides/cancel/[id]';
import EditRideRoute from '../app/rides/edit/[id]';
import RideInviteRoute from '../app/rides/invite/[id]';
import NewRideRoute from '../app/rides/new';
import ReportRideRoute from '../app/rides/report/[id]';
import RideRoutePickRoute from '../app/rides/route-pick';
import MyRouteRoute from '../app/routes/mine/[id]';
import MyRoutePublishRoute from '../app/routes/mine/publish/[id]';
import RouteRidePickRoute from '../app/routes/pick/[routeId]';
import ReportRouteRoute from '../app/routes/report/[id]';
import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import RouteStoryRoute from '../app/routes/story/[id]';
import DevicesScreen from '../app/settings/devices';
import SettingsScreen from '../app/settings/index';
import LanguageScreen from '../app/settings/language';
import NotificationSettingsScreen from '../app/settings/notifications';
import ProfileScreen from '../app/settings/profile';
import ThemeScreen from '../app/settings/theme';
import VerifiedProfileScreen from '../app/settings/verified';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const ID = '0190a6f4-0000-7000-8000-00000000abcd';
const RIDER = `rider${'0'.repeat(38)}`;

function Home() {
  return <Text>Главная</Text>;
}

/**
 * Экраны под гардом вкладок (`Stack.Protected` корневого layout, вне `(tabs)`): гард пускает их, пока сессия
 * `unknown` / `unavailable` (pokatim-app.md «Сессия в вебе»). Прямой адрес без восстановленной сессии (web без API,
 * смоук `e2e/web.spec.ts` без `E2E_API`) — оболочка: скелетон, затем «Нет соединения» с повтором `hydrate`, а не
 * контент экрана с запросом без сессии («Не удалось загрузить» и повтор запроса, который сессию не восстановит).
 */
const PROTECTED: [string, ComponentType, string][] = [
  ['settings/devices', DevicesScreen, '/settings/devices'],
  ['settings/index', SettingsScreen, '/settings'],
  ['settings/language', LanguageScreen, '/settings/language'],
  ['settings/theme', ThemeScreen, '/settings/theme'],
  ['settings/profile', ProfileScreen, '/settings/profile'],
  ['profile', OwnProfileRoute, '/profile'],
  ['social', SocialRoute, '/social'],
  ['notifications', NotificationsScreen, '/notifications'],
  ['settings/notifications', NotificationSettingsScreen, '/settings/notifications'],
  ['settings/verified', VerifiedProfileScreen, '/settings/verified'],
  ['rides/new', NewRideRoute, '/rides/new'],
  ['rides/edit/[id]', EditRideRoute, `/rides/edit/${ID}`],
  ['rides/cancel/[id]', CancelRideRoute, `/rides/cancel/${ID}`],
  ['rides/route-pick', RideRoutePickRoute, '/rides/route-pick?form=new'],
  ['rides/report/[id]', ReportRideRoute, `/rides/report/${ID}`],
  ['rides/invite/[id]', RideInviteRoute, `/rides/invite/${ID}`],
  ['routes/mine/[id]', MyRouteRoute, `/routes/mine/${ID}`],
  ['routes/mine/publish/[id]', MyRoutePublishRoute, `/routes/mine/publish/${ID}`],
  ['routes/report/[id]', ReportRouteRoute, `/routes/report/${ID}`],
  ['riders/report/[id]', ReportRiderRoute, `/riders/report/${RIDER}`],
  ['routes/pick/[routeId]', RouteRidePickRoute, `/routes/pick/${ID}`],
  ['routes/rides/[routeId]/[rideId]', RouteRideRoute, `/routes/rides/${ID}/${ID}`],
  ['routes/story/[id]', RouteStoryRoute, `/routes/story/${ID}`],
  ['races/pick/[id]', RacePickRoute, `/races/pick/${ID}`],
  ['races/result/[id]/[entryId]', RivalResultRoute, `/races/result/${ID}/${ID}`],
  ['races/story/[id]', StoryCardRoute, `/races/story/${ID}`],
  ['races/dispute/[id]/[entryId]', FileDisputeRoute, `/races/dispute/${ID}/${ID}`],
  [
    'races/dispute-response/[id]/[disputeId]',
    DisputeResponseRoute,
    `/races/dispute-response/${ID}/${ID}`,
  ],
  ['achievements/flash', AchievementFlashRoute, '/achievements/flash'],
  ['achievements/[code]', AchievementRoute, '/achievements/race_win'],
  ['achievements/story/[code]', AchievementStoryRoute, '/achievements/story/race_win'],
];

const realHydrate = useSessionStore.getState().hydrate;
afterEach(() =>
  useSessionStore.setState({
    status: 'unknown',
    session: null,
    restoreError: null,
    hydrate: realHydrate,
  }),
);

/** Ни один метод `api` не вызван: без сессии экрану нечего запрашивать. */
function expectNoApiCalls() {
  const called = Object.entries(api)
    .filter(([, value]) => jest.isMockFunction(value) && value.mock.calls.length > 0)
    .map(([name]) => name);
  expect(called).toEqual([]);
}

it.each(PROTECTED)(
  '%s: unknown — скелетон оболочки; unavailable (сеть) — «Нет соединения», «Повторить» — hydrate; без запросов',
  async (name, Screen, path) => {
    const hydrate = jest.fn(async () => undefined);
    useSessionStore.setState({ status: 'unknown', session: null, hydrate });
    await renderRouter(
      { index: Home, [name]: Screen },
      { initialUrl: path, wrapper: createQueryWrapper() },
    );
    expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();

    await act(async () =>
      useSessionStore.setState({
        status: 'unavailable',
        restoreError: new ApiNetworkError(new TypeError('Network request failed')),
      }),
    );
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(hydrate).toHaveBeenCalled();
    expectNoApiCalls();
  },
);
