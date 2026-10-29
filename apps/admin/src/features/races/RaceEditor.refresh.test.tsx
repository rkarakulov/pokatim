// @vitest-environment jsdom
import { RACE_FIELDS, type PanelRace, type PanelSeason } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    getRace: vi.fn(),
    updateRace: vi.fn(),
    publishRace: vi.fn(),
    cancelRace: vi.fn(),
    discardRace: vi.fn(),
    getEventTicketing: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const SEASON_ID = '01890a5d-ac96-774b-bcce-b302099a8070';
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';

const SEASON: PanelSeason = {
  id: SEASON_ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
  raceCount: 1,
  version: 0,
};

const race = (overrides: Partial<PanelRace> = {}): PanelRace => ({
  id: RACE_ID,
  status: 'published',
  phase: 'upcoming',
  title: 'Осенний коридор Заславль',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 64,
  description: 'Равнинный коридор',
  windowStartsAt: '2026-10-18T21:00:00.000Z',
  windowEndsAt: '2026-10-25T20:59:00.000Z',
  protocolPlannedAt: '2026-10-27T20:59:00.000Z',
  season: { id: SEASON_ID, name: 'Сезон 2026', preview: false },
  owner: { userId: USER_ID, displayName: 'Ира' },
  cancelReason: null,
  corridor: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  publishedAt: '2026-10-01T10:00:00.000Z',
  cancelledAt: null,
  version: 3,
  editable: {
    fields: [...RACE_FIELDS],
    canPublish: false,
    canCancel: true,
    canDiscard: false,
    reasons: [],
  },
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  // блок «Билеты» опубликованной гонки (event-tickets PR C) — не мешает проверкам обновления
  mocked.getEventTicketing.mockRejectedValue(httpError(404, 'NOT_FOUND'));
  mocked.listSeasons.mockResolvedValue({ items: [SEASON] });
  mocked.listRoutes.mockResolvedValue({ items: [], nextCursor: null });
  mocked.getRace.mockResolvedValue(race());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const seasonOutput = () => screen.getByRole('status', { name: 'Сезон (по концу окна)' });

async function openRace() {
  const app = await renderApp(`/races/${RACE_ID}`);
  await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });
  return app;
}

describe('редактор гонки: фоновое обновление (R3, §4.12)', () => {
  it('refetch с новой версией и чужим названием — баннер конфликта, введённое сохраняется, запрос — со старой версией и без названия', async () => {
    mocked.updateRace.mockRejectedValue(httpError(409, 'CONFLICT'));
    const { queryClient } = await openRace();
    fireEvent.change(input(/^Описание/), { target: { value: 'Моя правка' } });

    mocked.getRace.mockResolvedValue(race({ title: 'Чужое название', version: 4 }));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'races', 'item', RACE_ID] });
    });

    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
    expect(input(/^Описание/).value).toBe('Моя правка');
    expect(input(/^Название/).value).toBe('Осенний коридор Заславль');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    await waitFor(() =>
      expect(mocked.updateRace).toHaveBeenCalledWith(RACE_ID, {
        version: 3,
        description: 'Моя правка',
      }),
    );
  });

  it('«Обновить» после конфликта — форма и версия из свежей записи', async () => {
    mocked.updateRace.mockResolvedValue(race({ title: 'Чужое название', version: 5 }));
    const { queryClient } = await openRace();
    mocked.getRace.mockResolvedValue(race({ title: 'Чужое название', version: 4 }));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'races', 'item', RACE_ID] });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(input(/^Название/).value).toBe('Чужое название'));
    expect(screen.queryByText('Запись изменили — обновите страницу')).toBeNull();

    fireEvent.change(input(/^Описание/), { target: { value: 'После обновления' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    await waitFor(() =>
      expect(mocked.updateRace).toHaveBeenCalledWith(RACE_ID, {
        version: 4,
        description: 'После обновления',
      }),
    );
  });

  it('ошибка обновления при показанных данных — редактор остаётся, сверху баннер с повтором', async () => {
    const { queryClient } = await openRace();
    mocked.getRace.mockRejectedValue(networkError());
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: ['admin', 'races', 'item', RACE_ID] })
        .catch(() => undefined);
    });

    expect(await screen.findByText('Не удалось обновить данные')).toBeTruthy();
    expect(input(/^Название/).value).toBe('Осенний коридор Заславль');
    mocked.getRace.mockResolvedValue(race());
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось обновить данные')).toBeNull());
  });
});

describe('редактор гонки: состояния списка сезонов (§4.12)', () => {
  it('первая загрузка сезонов — скелетон вычисляемого сезона, не «нет сезона»', async () => {
    mocked.listSeasons.mockReturnValue(new Promise(() => undefined));
    await openRace();
    expect(seasonOutput().querySelector('.skeleton')).toBeTruthy();
    expect(screen.queryByText('Конец окна не попадает ни в один сезон')).toBeNull();
  });

  it('ошибка без данных — сообщение с повтором; после успешного ответа — сезон', async () => {
    mocked.listSeasons.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await openRace();
    expect(await screen.findByText('Не удалось загрузить сезоны')).toBeTruthy();
    expect(screen.queryByText('Конец окна не попадает ни в один сезон')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку сезонов' }));
    await waitFor(() => expect(seasonOutput().textContent).toContain('Сезон 2026'));
  });

  it('«нет сезона» — только после успешного ответа без подходящего сезона', async () => {
    mocked.listSeasons.mockResolvedValue({ items: [] });
    await openRace();
    await waitFor(() =>
      expect(seasonOutput().textContent).toBe('Конец окна не попадает ни в один сезон'),
    );
  });
});

describe('редактор гонки: свежие вычисляемые поля при прежней версии (Codex pass 2)', () => {
  it('появился сезон — «Опубликовать» доступна без смены версии, введённое сохраняется', async () => {
    const draft = (overrides: Partial<PanelRace>) =>
      race({
        status: 'draft',
        phase: 'draft',
        season: null,
        editable: {
          fields: [...RACE_FIELDS],
          canPublish: false,
          canCancel: false,
          canDiscard: true,
          reasons: ['outside_season'],
        },
        ...overrides,
      });
    mocked.getRace.mockResolvedValue(draft({}));
    mocked.publishRace.mockResolvedValue(race({ version: 4 }));
    const { queryClient } = await openRace();
    expect(screen.getByRole('button', { name: 'Опубликовать' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.change(input(/^Описание/), { target: { value: 'Моя правка' } });

    mocked.getRace.mockResolvedValue(
      draft({
        season: { id: SEASON_ID, name: 'Сезон 2026', preview: true },
        editable: {
          fields: [...RACE_FIELDS],
          canPublish: true,
          canCancel: false,
          canDiscard: true,
          reasons: [],
        },
      }),
    );
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'races', 'item', RACE_ID] });
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Опубликовать' }).getAttribute('aria-disabled'),
      ).toBeNull(),
    );
    expect(screen.queryByText('Запись изменили — обновите страницу')).toBeNull();
    expect(input(/^Описание/).value).toBe('Моя правка');
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Опубликовать' }),
    );
    await waitFor(() => expect(mocked.publishRace).toHaveBeenCalledWith(RACE_ID, { version: 3 }));
  });

  it('окно открылось (та же версия) — начало окна зафиксировано, причина видна', async () => {
    const { queryClient } = await openRace();
    expect(input(/^Окно: начало/).disabled).toBe(false);

    mocked.getRace.mockResolvedValue(
      race({
        phase: 'open',
        editable: {
          fields: RACE_FIELDS.filter((field) => field !== 'windowStartsAt'),
          canPublish: false,
          canCancel: true,
          canDiscard: false,
          reasons: ['window_open'],
        },
      }),
    );
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'races', 'item', RACE_ID] });
    });

    await waitFor(() => expect(input(/^Окно: начало/).disabled).toBe(true));
    expect(screen.getByText('Окно открыто: начало окна зафиксировано.')).toBeTruthy();
    expect(screen.getByText(/^Окно открыто · протокол по плану/)).toBeTruthy();
  });
});
