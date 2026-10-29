// @vitest-environment jsdom
import { type PanelRace, type PanelRoute, type PanelSeason, RACE_FIELDS } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp, USER_ID } from '../../test/app';
import { loadMaplibre } from '../maps/load-maplibre';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    listRaces: vi.fn(),
    getRace: vi.fn(),
    updateRace: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
  },
}));
// jsdom без WebGL: карта не грузится (место карты с подписью)
vi.mock('../maps/load-maplibre', () => ({ loadMaplibre: vi.fn() }));

const mocked = vi.mocked(api);
const SEASON_ID = '01890a5d-ac96-774b-bcce-b302099a8070';
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const ROUTE_ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const STYLE = 'https://tiles.example/styles/positron';

const SEASON: PanelSeason = {
  id: SEASON_ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
  raceCount: 1,
  version: 0,
};

const route = (overrides: Partial<PanelRoute> = {}): PanelRoute => ({
  id: ROUTE_ID,
  title: 'Минское кольцо',
  status: 'ready',
  failure: null,
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  owner: { userId: USER_ID, displayName: 'Ольга' },
  createdAt: '2026-10-20T10:00:00.000Z',
  catalog: null,
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
  ],
  elevation: {
    minM: 191,
    maxM: 267,
    profile: [
      [0, 200],
      [43_000, 267],
      [86_012, 191],
    ],
  },
  ...overrides,
});

const race = (overrides: Partial<PanelRace> = {}): PanelRace => ({
  id: RACE_ID,
  status: 'published',
  phase: 'upcoming',
  title: 'Осенний коридор Заславль',
  bikeClass: 'road',
  surfaces: ['gravel'],
  distanceKm: 86,
  description: null,
  windowStartsAt: '2026-10-18T21:00:00.000Z',
  windowEndsAt: '2026-10-25T20:59:00.000Z',
  protocolPlannedAt: '2026-10-27T20:59:00.000Z',
  season: { id: SEASON_ID, name: 'Сезон 2026', preview: true },
  owner: { userId: USER_ID, displayName: 'Ира' },
  cancelReason: null,
  corridor: { route: { id: ROUTE_ID, title: 'Минское кольцо' }, widthM: 50, distanceM: 86_012 },
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  publishedAt: '2026-10-02T10:00:00.000Z',
  cancelledAt: null,
  version: 3,
  editable: {
    fields: RACE_FIELDS.filter((field) => field !== 'distanceKm'),
    canPublish: false,
    canCancel: false,
    canDiscard: false,
    reasons: [],
  },
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
  mocked.listSeasons.mockResolvedValue({ items: [SEASON] });
  mocked.listRoutes.mockResolvedValue({ items: [], nextCursor: null });
  mocked.getRoute.mockResolvedValue(route());
  mocked.getRace.mockResolvedValue(race());
  vi.mocked(loadMaplibre).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

const text = (value: string | null | undefined) => value?.replace(/\u00a0/g, ' ');
const block = () => screen.getByRole('region', { name: 'Карта гонки' });

async function openRace() {
  const app = await renderApp(`/races/${RACE_ID}`);
  await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });
  return app;
}

describe('карта гонки с коридором (panel-race-map, AC1–AC4)', () => {
  it('опубликованная гонка с env стиля: карта гонки с коридором, цифры по покрытию гонки, профиль со скраббингом', async () => {
    vi.stubEnv('VITE_MAP_STYLE_LIGHT', STYLE);
    await openRace();
    const section = await screen.findByRole('region', { name: 'Карта гонки' });
    expect(
      within(section).getByRole('img', {
        name: /^Карта гонки: маршрут «Минское кольцо», 86,0.км, коридор ±50 м от маршрута/,
      }),
    ).toBeTruthy();
    // подзаголовки блока — уровнем ниже заголовка секции
    expect(within(section).getByRole('heading', { name: 'Профиль высоты', level: 3 })).toBeTruthy();
    const tile = within(section).getByRole('group', { name: 'В пути' });
    expect(text(tile.textContent)).toContain('при 20 км/ч');
    expect(text(within(section).getByText(/^Коридор: ±50 м от маршрута/).textContent)).toBe(
      'Коридор: ±50 м от маршрута · Открыть маршрут (в новой вкладке)',
    );
    const link = within(section).getByRole('link', { name: /Открыть маршрут/ });
    expect(link.getAttribute('target')).toBe('_blank');
    const slider = within(section).getByRole('slider', { name: /^Профиль высоты/ });
    const before = slider.getAttribute('aria-valuetext');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).not.toBe(before);
  });

  it('черновик с коридором без env стиля — линия с коридором текстом; без коридора и у новой гонки — блока нет', async () => {
    mocked.getRace.mockResolvedValue(race({ status: 'draft', phase: 'draft', publishedAt: null }));
    await openRace();
    await screen.findByRole('region', { name: 'Карта гонки' });
    expect(
      within(block()).getByRole('img', {
        name: /^Линия гонки: маршрут «Минское кольцо», 86,0.км, коридор ±50 м от маршрута/,
      }),
    ).toBeTruthy();
    expect(within(block()).queryByTestId('route-map')).toBeNull();
    cleanup();

    mocked.getRace.mockResolvedValue(race({ corridor: null }));
    await openRace();
    expect(screen.queryByRole('region', { name: 'Карта гонки' })).toBeNull();
    cleanup();

    await renderApp('/races/new');
    await screen.findByRole('heading', { name: 'Новая гонка', level: 1 });
    expect(screen.queryByRole('region', { name: 'Карта гонки' })).toBeNull();
  });

  it('загрузка — скелетон карты в секции; маршрут не готов — блока нет', async () => {
    mocked.getRoute.mockReturnValue(new Promise(() => {}));
    await openRace();
    expect(within(block()).getByTestId('skeleton-map')).toBeTruthy();
    cleanup();

    mocked.getRoute.mockResolvedValue(route({ status: 'processing' }));
    await openRace();
    await waitFor(() => expect(mocked.getRoute).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Карта гонки' })).toBeNull();
  });

  it('ошибка без данных — «Нет соединения» с повтором; ошибка обновления при данных — баннер, карта остаётся', async () => {
    mocked.getRoute.mockRejectedValueOnce(networkError()).mockResolvedValue(route());
    await openRace();
    await waitFor(() => expect(within(block()).getByText('Нет соединения')).toBeTruthy());
    fireEvent.click(within(block()).getByRole('button', { name: 'Повторить' }));
    expect(await within(block()).findByRole('slider')).toBeTruthy();
    cleanup();

    const { queryClient } = await openRace();
    await within(await screen.findByRole('region', { name: 'Карта гонки' })).findByRole('slider');
    mocked.getRoute.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: ['admin', 'routes', 'item', ROUTE_ID] })
        .catch(() => undefined);
    });
    const banner = await within(block()).findByRole('alert');
    expect(within(banner).getByText('Не удалось обновить карту гонки')).toBeTruthy();
    expect(within(block()).getByRole('slider')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(within(block()).queryByRole('alert')).toBeNull());
  });
});
