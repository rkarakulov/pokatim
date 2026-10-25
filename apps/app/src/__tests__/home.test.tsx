/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { ProfileView } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done' });
});
afterEach(() => jest.clearAllMocks());

const profile = (rideReasons: ProfileView['rideReasons']) =>
  getProfile.mockResolvedValue({ rideReasons });

async function openHome() {
  return renderRouter(tabRoutes, { initialUrl: '/', wrapper: createQueryWrapper() });
}

/** Заголовки разделов ленты сверху вниз (словесный знак панели — тоже заголовок, он первый). */
const sectionTitles = () =>
  screen
    .getAllByRole('header')
    .map((header) => header.props.children as string)
    .filter((title) => title !== 'ПОКАТИМ');

describe('Главная: каркас (S3)', () => {
  it('верхняя панель, шапки разделов сразу, скелетоны на месте героев; Маршрутов и Кофе-райдов нет (AC3, AC7)', async () => {
    getProfile.mockReturnValue(new Promise(() => undefined));
    await openHome();

    expect(screen.getByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
    // кикеры разделов (такие же подписи у вкладок — ищем в ленте)
    const feed = within(screen.getByTestId('home-feed'));
    expect(feed.getByText('Гонки')).toBeOnTheScreen();
    expect(feed.getByText('Календарь')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка')).toHaveLength(2);
    expect(screen.queryByText('Маршруты рядом с вами')).toBeNull();
    expect(screen.queryByText('Кофе-райды')).toBeNull();
    expect(screen.queryByText('по вашему выбору')).toBeNull();
    // временно внизу Главной (Q8)
    expect(screen.getByText('Выйти')).toBeOnTheScreen();
  });

  it('профиль — Bearer access сессии; «Календарь» в опросе → «Ближайшие старты» первыми с тегом (AC4)', async () => {
    profile(['calendar']);
    await openHome();

    await waitFor(() => expect(sectionTitles()).toEqual(['Ближайшие старты', 'Ближайшие гонки']));
    expect(screen.getAllByText('по вашему выбору')).toHaveLength(1);
    expect(getProfile).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('оба раздела отмечены — оба с тегом, порядок вкладок (AC4)', async () => {
    profile(['calendar', 'races']);
    await openHome();

    await waitFor(() => expect(screen.getAllByText('по вашему выбору')).toHaveLength(2));
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
  });

  it.each([
    ['«Пока просто смотрю»', ['exploring'] as const],
    ['раздел без бэкенда', ['routes'] as const],
  ])('%s — базовый порядок без тегов (AC4)', async (_name, reasons) => {
    profile([...reasons]);
    await openHome();

    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
    expect(screen.queryByText('по вашему выбору')).toBeNull();
  });

  it('ошибка профиля — базовый порядок, ошибка на экране не показывается (AC4)', async () => {
    getProfile.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openHome();

    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('«Все гонки» → вкладка «Гонки», «Все старты» → вкладка «Календарь»', async () => {
    profile([]);
    const router = await openHome();

    await fireEvent.press(screen.getByText('Все гонки'));
    expect(router.getPathname()).toBe('/races');
    expect(screen.getByRole('tab', { name: 'Гонки' })).toBeSelected();

    await fireEvent.press(screen.getByRole('tab', { name: 'Главная' }));
    await fireEvent.press(await screen.findByText('Все старты'));
    expect(router.getPathname()).toBe('/calendar');
  });

  it('pull-to-refresh перезапрашивает профиль; индикатор — только на время жеста (AC6)', async () => {
    profile(['races']);
    await openHome();
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));

    const control = () =>
      screen.getByTestId('home-feed').props.refreshControl as ReactElement<RefreshControlProps>;
    expect(control().props.refreshing).toBe(false);

    await act(async () => {
      control().props.onRefresh?.();
    });
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(control().props.refreshing).toBe(false));
  });
});
