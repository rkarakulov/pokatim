// @vitest-environment jsdom
import type { PanelRoute } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp, USER_ID } from '../../test/app';
import { loadMaplibre } from '../maps/load-maplibre';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    publishRoute: vi.fn(),
    unpublishRoute: vi.fn(),
  },
}));
// jsdom без WebGL: карта не грузится (место карты с подписью)
vi.mock('../maps/load-maplibre', () => ({ loadMaplibre: vi.fn() }));

const mocked = vi.mocked(api);
const ROUTE_ID = '01890a5d-ac96-774b-bcce-b302099a8090';

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

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
  mocked.getRoute.mockResolvedValue(route());
  vi.mocked(loadMaplibre).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

const text = (value: string | null | undefined) => value?.replace(/\u00a0/g, ' ');
const tile = (label: string) =>
  text(screen.getByRole('group', { name: label }).textContent?.replace(label, ''));

describe('страница маршрута панели (routes-05, AC1–AC3)', () => {
  it('готовый без env стиля: линия вместо карты, цифры, профиль-слайдер; крошка «Маршруты»', async () => {
    await renderApp(`/routes/${ROUTE_ID}`);
    expect(await screen.findByRole('heading', { name: 'Минское кольцо', level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Маршруты' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('img', { name: /Линия маршрута «Минское кольцо»/ })).toBeTruthy();
    expect(screen.queryByTestId('route-map')).toBeNull();
    expect(tile('Длина')).toBe('86,0 км');
    expect(tile('Набор')).toBe('412 м');
    expect(tile('Макс. высота')).toBe('267 м');
    expect(tile('Мин. высота')).toBe('191 м');
    expect(tile('Форма')).toBe('Круговой');
    // не в каталоге — покрытие неизвестно, скорость как асфальт (RC-11)
    expect(tile('В пути')).toBe('3 ч 10 минпри 27 км/ч');
    const slider = screen.getByRole('slider', {
      name: 'Профиль высоты: от 191 до 267 м, набор 412 м',
    });
    const before = slider.getAttribute('aria-valuetext');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).not.toBe(before);
    expect(text(slider.getAttribute('aria-valuetext'))).toMatch(/^1 км, высота/);
  });

  it('с env стиля — карта маршрута (подпись-альтернатива); опубликованный гравий — 20 км/ч', async () => {
    vi.stubEnv('VITE_MAP_STYLE_LIGHT', 'https://tiles.example/styles/positron');
    mocked.getRoute.mockResolvedValue(
      route({
        catalog: { city: 'minsk', surfaces: ['gravel'], publishedAt: '2026-10-21T10:00:00.000Z' },
      }),
    );
    await renderApp(`/routes/${ROUTE_ID}`);
    const map = await screen.findByTestId('route-map');
    expect(within(map).getByRole('img', { name: /Минское кольцо/ })).toBeTruthy();
    expect(document.querySelector('.line-preview')).toBeNull();
    expect(tile('В пути')).toBe('4 ч 20 минпри 20 км/ч');
    expect(screen.getByText(/Минск · гравий/)).toBeTruthy();
  });

  it('блок «карта · цифры · профиль»: цифры строкой между картой и профилем, без плиток; весь блок — на весь экран', async () => {
    vi.stubEnv('VITE_MAP_STYLE_LIGHT', 'https://tiles.example/styles/positron');
    await renderApp(`/routes/${ROUTE_ID}`);
    const map = await screen.findByTestId('route-map');
    const view = screen.getByTestId('route-view');
    const stats = screen.getByRole('group', { name: 'Длина' });
    const slider = screen.getByRole('slider', { name: /^Профиль высоты/ });
    for (const node of [map, stats, slider]) expect(view.contains(node)).toBe(true);
    expect(map.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stats.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.querySelector('.stat-tile')).toBeNull();
    expect(stats.closest('.route-stats')).not.toBeNull();
    // заголовок «Цифры» — для скринридера, уровень страницы
    expect(screen.getByRole('heading', { name: 'Цифры', level: 2 }).className).toContain(
      'visually-hidden',
    );
  });

  it('без профиля высоты — «Нет данных о высоте», слайдера нет; цифры высот — «—»', async () => {
    mocked.getRoute.mockResolvedValue(route({ elevation: null }));
    await renderApp(`/routes/${ROUTE_ID}`);
    expect(await screen.findByText('Нет данных о высоте')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(tile('Макс. высота')).toBe('—');
  });

  it('загрузка — скелетон под шапкой; 404 — «Маршрут не найден»; 403 — нет доступа', async () => {
    mocked.getRoute.mockReturnValue(new Promise(() => {}));
    await renderApp(`/routes/${ROUTE_ID}`);
    expect(await screen.findByTestId('skeleton-map')).toBeTruthy();
    cleanup();

    mocked.getRoute.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await renderApp(`/routes/${ROUTE_ID}`);
    expect(await screen.findByText('Маршрут не найден')).toBeTruthy();
    cleanup();

    mocked.getRoute.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await renderApp(`/routes/${ROUTE_ID}`);
    expect(await screen.findByText(/Нет доступа/)).toBeTruthy();
  });

  it('ошибка — с повтором; ошибка обновления при данных — баннер с повтором', async () => {
    mocked.getRoute.mockRejectedValueOnce(networkError()).mockResolvedValue(route());
    await renderApp(`/routes/${ROUTE_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Минское кольцо', level: 1 })).toBeTruthy();
    cleanup();

    mocked.getRoute.mockResolvedValueOnce(route()).mockRejectedValue(networkError());
    const { queryClient } = await renderApp(`/routes/${ROUTE_ID}`);
    await screen.findByRole('heading', { name: 'Минское кольцо', level: 1 });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'routes', 'item', ROUTE_ID] });
    });
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('processing — статус и опрос; дольше 5 мин — «проверьте позже»; «Обновить» — новое окно 5 мин; готов — профиль', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const processing = route({
        status: 'processing',
        distanceM: null,
        elevationGainM: null,
        isLoop: null,
        line: [],
        elevation: null,
      });
      mocked.getRoute.mockResolvedValue(processing);
      await renderApp(`/routes/${ROUTE_ID}`);
      expect(
        await screen.findByText('Маршрут обрабатывается — страница обновится сама'),
      ).toBeTruthy();
      expect(screen.queryByRole('slider')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(mocked.getRoute.mock.calls.length).toBeGreaterThanOrEqual(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      expect(screen.getByText('Обрабатывается — проверьте позже')).toBeTruthy();
      const calls = mocked.getRoute.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mocked.getRoute.mock.calls.length).toBe(calls);

      // ревью pass 1 (M1): «Обновить», маршрут всё ещё processing — новое окно опроса не дольше 5 мин
      fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
      expect(
        await screen.findByText('Маршрут обрабатывается — страница обновится сама'),
      ).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      expect(screen.getByText('Обрабатывается — проверьте позже')).toBeTruthy();
      const again = mocked.getRoute.mock.calls.length;
      expect(again).toBeGreaterThan(calls + 100);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mocked.getRoute.mock.calls.length).toBe(again);

      mocked.getRoute.mockResolvedValue(route());
      fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
      expect(await screen.findByRole('slider')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('failed — причина, без карты, цифр и профиля', async () => {
    mocked.getRoute.mockResolvedValue(
      route({ status: 'failed', failure: 'too_short', line: [], elevation: null }),
    );
    await renderApp(`/routes/${ROUTE_ID}`);
    expect(await screen.findByText('Маршрут короче 1 км')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Длина' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('действия каталога — только с races.manage; окно публикации без «Открыть маршрут»', async () => {
    await renderApp(`/routes/${ROUTE_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Опубликовать в каталоге' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Опубликовать «Минское кольцо» в каталоге',
    });
    await within(dialog).findByRole('img', { name: /Линия маршрута/ });
    expect(within(dialog).queryByRole('link', { name: /Открыть маршрут/ })).toBeNull();
    cleanup();

    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp(`/routes/${ROUTE_ID}`);
    await screen.findByRole('heading', { name: 'Минское кольцо', level: 1 });
    expect(screen.queryByRole('button', { name: 'Опубликовать в каталоге' })).toBeNull();
    await waitFor(() => expect(mocked.getRoute).toHaveBeenCalledWith(ROUTE_ID));
  });

  it('окно публикации с env стиля — компактная карта (AC2), подпись «Карта маршрута …»', async () => {
    vi.stubEnv('VITE_MAP_STYLE_LIGHT', 'https://tiles.example/styles/positron');
    mocked.listRoutes.mockResolvedValue({ items: [route()], nextCursor: null });
    await renderApp('/routes');
    fireEvent.click(await screen.findByRole('button', { name: /Опубликовать в каталоге/ }));
    const dialog = await screen.findByRole('dialog');
    const map = await within(dialog).findByTestId('route-map');
    expect(map.className).toContain('route-map--compact');
    expect(
      within(map).getByRole('img', {
        name: 'Карта маршрута «Минское кольцо»: 86,0 км, старт и финиш отмечены',
      }),
    ).toBeTruthy();
    expect(dialog.querySelector('.line-preview')).toBeNull();
  });
});
