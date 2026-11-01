// @vitest-environment jsdom
import type { PanelRoute, PanelRouteSummary } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, networkError, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    uploadRoute: vi.fn(),
    publishRoute: vi.fn(),
    unpublishRoute: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ROUTE_ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const PUBLISHED_ID = '01890a5d-ac96-774b-bcce-b302099a8091';
const FAILED_ID = '01890a5d-ac96-774b-bcce-b302099a8092';

const summary = (overrides: Partial<PanelRouteSummary> = {}): PanelRouteSummary => ({
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
  ...overrides,
});
const route = (overrides: Partial<PanelRoute> = {}): PanelRoute => ({
  ...summary(),
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
  ],
  elevation: null,
  ...overrides,
});
const PUBLISHED = summary({
  id: PUBLISHED_ID,
  title: 'Заславль',
  isLoop: false,
  catalog: {
    city: 'minsk',
    surfaces: ['asphalt', 'gravel'],
    publishedAt: '2026-10-21T10:00:00.000Z',
  },
});
const FAILED = summary({
  id: FAILED_ID,
  title: 'Битый файл',
  status: 'failed',
  failure: 'too_short',
  distanceM: null,
  elevationGainM: null,
  isLoop: null,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
  mocked.listRoutes.mockResolvedValue({ items: [summary(), PUBLISHED, FAILED], nextCursor: null });
  mocked.getRoute.mockResolvedValue(route());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const text = (value: string | null | undefined) => value?.replace(/\u00a0/g, ' ');
const rowOf = async (title: string) =>
  (await screen.findByRole('cell', { name: title })).closest('tr')!;

describe('«Маршруты» панели (routes-01)', () => {
  it('таблица: длина, набор, петля, статус, автор и «В каталоге»; отказ — причина', async () => {
    await renderApp('/routes');
    expect(await screen.findByRole('heading', { name: 'Маршруты', level: 1 })).toBeTruthy();
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => text(cell.textContent));
    expect(cells(await rowOf('Минское кольцо')).slice(0, 7)).toEqual([
      'Минское кольцо',
      '86,0 км',
      '412 м',
      'Да',
      'Готов',
      'Ольга',
      '—',
    ]);
    expect(cells(await rowOf('Заславль')).slice(0, 7)).toEqual([
      'Заславль',
      '86,0 км',
      '412 м',
      'Нет',
      'Готов',
      'Ольга',
      'Минск · асфальт, гравий',
    ]);
    const failed = await rowOf('Битый файл');
    expect(within(failed).getByText('Маршрут короче 1 км')).toBeTruthy();
    expect(within(failed).queryByRole('button')).toBeNull();
    expect(mocked.listRoutes).toHaveBeenCalledWith({ limit: 50 });
  });

  it('routes-05: название — ссылка на страницу маршрута (и у отказа); окно публикации — «Открыть маршрут» в той же вкладке', async () => {
    const { router } = await renderApp('/routes');
    const failed = await rowOf('Битый файл');
    expect(within(failed).getByRole('link', { name: 'Битый файл' }).getAttribute('href')).toBe(
      `/admin/routes/${FAILED_ID}`,
    );
    fireEvent.click(
      within(await rowOf('Минское кольцо')).getByRole('button', {
        name: /Опубликовать в каталоге/,
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const open = await within(dialog).findByRole('link', { name: 'Открыть маршрут' });
    expect(open.getAttribute('target')).toBeNull();
    fireEvent.click(open);
    await waitFor(() => expect(currentHref(router)).toBe(`/admin/routes/${ROUTE_ID}`));
    expect(await screen.findByRole('heading', { name: 'Минское кольцо', level: 1 })).toBeTruthy();
  });

  it('пусто — «Маршрутов пока нет»', async () => {
    mocked.listRoutes.mockResolvedValue({ items: [], nextCursor: null });
    await renderApp('/routes');
    expect(await screen.findByText('Маршрутов пока нет')).toBeTruthy();
  });

  it('без races.manage — нет действий и загрузки', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/routes');
    await rowOf('Минское кольцо');
    expect(screen.queryByRole('button', { name: /Опубликовать в каталоге/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Снять с публикации/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Загрузить маршрут' })).toBeNull();
  });

  it('публикация: город и покрытие обязательны, POST с телом, строка обновлена', async () => {
    await renderApp('/routes');
    const row = await rowOf('Минское кольцо');
    fireEvent.click(within(row).getByRole('button', { name: /Опубликовать в каталоге/ }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Опубликовать «Минское кольцо» в каталоге',
    });
    expect(within(dialog).getByText(/Линия, старт и финиш станут видны всем/)).toBeTruthy();
    expect(await within(dialog).findByRole('img', { name: /Минское кольцо/ })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(within(dialog).getAllByText('Заполните поле.')).toHaveLength(2));
    expect(mocked.publishRoute).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Город старта/), {
      target: { value: 'minsk' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Гравий' }));
    const published = route({
      catalog: { city: 'minsk', surfaces: ['gravel'], publishedAt: '2026-10-27T10:00:00.000Z' },
    });
    mocked.publishRoute.mockResolvedValue(published);
    mocked.listRoutes.mockResolvedValue({
      items: [summary({ catalog: published.catalog }), PUBLISHED, FAILED],
      nextCursor: null,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() =>
      expect(mocked.publishRoute).toHaveBeenCalledWith(ROUTE_ID, {
        title: 'Минское кольцо',
        city: 'minsk',
        surfaces: ['gravel'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () =>
      expect(within(await rowOf('Минское кольцо')).getByText('Минск · гравий')).toBeTruthy(),
    );
  });

  it('«Изменить» — окно с текущими городом и покрытием; 409 ROUTE_INVALID_STATE — текст в окне', async () => {
    await renderApp('/routes');
    const row = await rowOf('Заславль');
    fireEvent.click(within(row).getByRole('button', { name: /Изменить/ }));
    const dialog = await screen.findByRole('dialog', { name: '«Заславль» в каталоге' });
    expect((within(dialog).getByLabelText(/^Город старта/) as HTMLSelectElement).value).toBe(
      'minsk',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Асфальт' }).getAttribute('aria-pressed'),
    ).toBe('true');
    mocked.publishRoute.mockRejectedValue(httpError(409, 'ROUTE_INVALID_STATE'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocked.publishRoute).toHaveBeenCalledWith(PUBLISHED_ID, {
        title: 'Заславль',
        city: 'minsk',
        surfaces: ['asphalt', 'gravel'],
      }),
    );
    expect(
      await within(dialog).findByText('Маршрут ещё не готов — опубликовать можно только готовый'),
    ).toBeTruthy();
  });

  it('routes-08 (RC-14): название — поле с текущим, обрезка пробелов, пустое — «Заполните поле.»', async () => {
    await renderApp('/routes');
    const row = await rowOf('Заславль');
    fireEvent.click(within(row).getByRole('button', { name: /Изменить/ }));
    const dialog = await screen.findByRole('dialog', { name: '«Заславль» в каталоге' });
    const title = within(dialog).getByLabelText(/^Название маршрута/) as HTMLInputElement;
    expect(title.value).toBe('Заславль');

    fireEvent.change(title, { target: { value: '  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(title.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('Заполните поле.')).toBeTruthy();
    expect(mocked.publishRoute).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: '  Заславль — Минск ' } });
    mocked.publishRoute.mockResolvedValue(route({ id: PUBLISHED_ID, title: 'Заславль — Минск' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocked.publishRoute).toHaveBeenCalledWith(PUBLISHED_ID, {
        title: 'Заславль — Минск',
        city: 'minsk',
        surfaces: ['asphalt', 'gravel'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ошибки сервера — под полями', async () => {
    await renderApp('/routes');
    const row = await rowOf('Заславль');
    fireEvent.click(within(row).getByRole('button', { name: /Изменить/ }));
    const dialog = await screen.findByRole('dialog', { name: '«Заславль» в каталоге' });
    mocked.publishRoute.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', {
        fields: [
          { path: 'city', code: 'INVALID' },
          { path: 'title', code: 'TOO_LONG' },
        ],
      }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    const city = within(dialog).getByLabelText(/^Город старта/);
    await waitFor(() => expect(city.getAttribute('aria-invalid')).toBe('true'));
    const title = within(dialog).getByLabelText(/^Название маршрута/);
    expect(title.getAttribute('aria-invalid')).toBe('true');
  });

  it('«Снять с публикации» — подтверждение → POST unpublish', async () => {
    await renderApp('/routes');
    const row = await rowOf('Заславль');
    fireEvent.click(within(row).getByRole('button', { name: /Снять с публикации/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Снять «Заславль» с публикации?' });
    mocked.unpublishRoute.mockResolvedValue(route({ id: PUBLISHED_ID, catalog: null }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Снять с публикации' }));
    await waitFor(() => expect(mocked.unpublishRoute).toHaveBeenCalledWith(PUBLISHED_ID));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('загрузка GPX — окно «Новый маршрут», список обновляется', async () => {
    await renderApp('/routes');
    await rowOf('Минское кольцо');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['<gpx/>'], 'Кольцо.gpx', { type: 'application/gpx+xml' });
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
    mocked.uploadRoute.mockResolvedValue(route({ id: FAILED_ID, status: 'processing', line: [] }));
    mocked.getRoute.mockResolvedValue(route({ id: FAILED_ID, status: 'processing', line: [] }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(mocked.uploadRoute).toHaveBeenCalledWith(file, 'Кольцо'));
    await waitFor(() => expect(mocked.listRoutes).toHaveBeenCalledTimes(2));
  });

  it('загрузка KML (upload-limits-kml-panel): выбор .gpx и .kml, файл .kml уходит в загрузку', async () => {
    await renderApp('/routes');
    await rowOf('Минское кольцо');
    expect(screen.getByRole('button', { name: 'Загрузить маршрут' })).toBeTruthy();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('.gpx,.kml,.kmz,.tcx');
    const file = new File(['<kml/>'], 'Озеро.kml', {
      type: 'application/vnd.google-earth.kml+xml',
    });
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
    mocked.uploadRoute.mockResolvedValue(route({ id: FAILED_ID, status: 'processing', line: [] }));
    mocked.getRoute.mockResolvedValue(route({ id: FAILED_ID, status: 'processing', line: [] }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(mocked.uploadRoute).toHaveBeenCalledWith(file, 'Озеро'));
  });

  it('опрос загрузки: сбои — баннер «продолжаем проверять»; дольше 5 мин — «проверьте позже» и «Обновить»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderApp('/routes');
      await rowOf('Минское кольцо');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [new File(['<gpx/>'], 'Кольцо.gpx', { type: 'application/gpx+xml' })] },
      });
      const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
      mocked.uploadRoute.mockResolvedValue(
        route({ id: FAILED_ID, status: 'processing', line: [] }),
      );
      mocked.getRoute.mockRejectedValue(networkError());
      fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
      await waitFor(() => expect(mocked.uploadRoute).toHaveBeenCalled());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(
        await screen.findByText('Не удаётся получить статус маршрута — продолжаем проверять'),
      ).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      expect(
        screen.getByText(
          'Маршрут обрабатывается дольше обычного — проверьте позже или загрузите файл ещё раз',
        ),
      ).toBeTruthy();
      const calls = mocked.listRoutes.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }));
      await waitFor(() => expect(mocked.listRoutes.mock.calls.length).toBeGreaterThan(calls));
    } finally {
      vi.useRealTimers();
    }
  });
});
