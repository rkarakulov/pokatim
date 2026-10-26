// @vitest-environment jsdom
import {
  type PanelRace,
  type PanelRoute,
  type PanelRouteSummary,
  type PanelSeason,
  RACE_FIELDS,
} from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    listRaces: vi.fn(),
    getRace: vi.fn(),
    createRace: vi.fn(),
    updateRace: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    uploadRoute: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const SEASON_ID = '01890a5d-ac96-774b-bcce-b302099a8070';
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const ROUTE_ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const NEW_ROUTE_ID = '01890a5d-ac96-774b-bcce-b302099a8091';

const SEASON: PanelSeason = {
  id: SEASON_ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
  raceCount: 1,
  version: 0,
};

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
  ...overrides,
});
const route = (overrides: Partial<PanelRoute> = {}): PanelRoute => ({
  ...summary(),
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
    [27.5, 53.9001],
  ],
  ...overrides,
});

const race = (overrides: Partial<PanelRace> = {}): PanelRace => ({
  id: RACE_ID,
  status: 'draft',
  phase: 'draft',
  title: 'Осенний коридор Заславль',
  bikeClass: 'road',
  surfaces: ['asphalt'],
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
  publishedAt: null,
  cancelledAt: null,
  version: 3,
  editable: {
    fields: RACE_FIELDS.filter((field) => field !== 'distanceKm'),
    canPublish: true,
    canCancel: false,
    canDiscard: true,
    reasons: [],
  },
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
  mocked.listSeasons.mockResolvedValue({ items: [SEASON] });
  mocked.listRoutes.mockResolvedValue({ items: [summary()], nextCursor: null });
  mocked.getRoute.mockResolvedValue(route());
  mocked.getRace.mockResolvedValue(race());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const corridorSelect = () => screen.getByLabelText(/^Эталонный коридор/) as HTMLSelectElement;
const text = (value: string | null | undefined) => value?.replace(/\u00a0/g, ' ');

async function newRace() {
  const app = await renderApp('/races/new');
  await screen.findByRole('heading', { name: 'Новая гонка', level: 1 });
  fireEvent.change(input(/^Название/), { target: { value: 'Осенний коридор Заславль' } });
  fireEvent.click(screen.getByRole('button', { name: 'Асфальт' }));
  fireEvent.change(input(/^Окно: начало/), { target: { value: '2026-10-19T00:00' } });
  fireEvent.change(input(/^Окно: конец/), { target: { value: '2026-10-25T23:59' } });
  fireEvent.change(input(/^Плановая дата протокола/), { target: { value: '2026-10-28T12:00' } });
  return app;
}

function chooseGpx(name = 'Кольцо вокруг Минска.gpx', size?: number) {
  const file = new File(['<gpx/>'], name, { type: 'application/gpx+xml' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(picker, { target: { files: [file] } });
  return file;
}

describe('поле «Эталонный коридор» (AC3, AC13)', () => {
  it('выбор готового маршрута: допуск 50 с подсказкой, дистанция только чтение, превью; в запрос — коридор без distanceKm', async () => {
    mocked.createRace.mockResolvedValue(race());
    await newRace();
    await waitFor(() => expect(corridorSelect().options).toHaveLength(2));
    expect(corridorSelect().value).toBe('');
    expect(input(/^Дистанция, км/)).toBeTruthy();

    fireEvent.change(corridorSelect(), { target: { value: ROUTE_ID } });
    expect(input(/^Допуск коридора, м/).value).toBe('50');
    expect(screen.getByText('Коридор: ±50 м от маршрута')).toBeTruthy();
    const distance = await screen.findByRole('status', { name: 'Дистанция, км' });
    await waitFor(() => expect(text(distance.textContent)).toBe('86,0 км — по маршруту'));
    const preview = await screen.findByRole('img', { name: /Линия маршрута «Минское кольцо»/ });
    expect(text(preview.getAttribute('aria-label'))).toBe(
      'Линия маршрута «Минское кольцо», 86,0 км',
    );
    expect(text(screen.getByText(/набор 412 м/).textContent)).toBe(
      '86,0 км · набор 412 м · Круговой',
    );

    fireEvent.change(input(/^Допуск коридора, м/), { target: { value: '100' } });
    expect(screen.getByText('Коридор: ±100 м от маршрута')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Создать гонку' }));
    await waitFor(() => expect(mocked.createRace).toHaveBeenCalledTimes(1));
    const body = mocked.createRace.mock.calls[0]![0];
    expect(body.corridor).toEqual({ routeId: ROUTE_ID, widthM: 100 });
    expect(body).not.toHaveProperty('distanceKm');
  });

  it('допуск вне шага — ошибка под полем без запроса; ROUTE_NOT_READY сервера — под полем коридора', async () => {
    mocked.createRace.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', {
        fields: [{ path: 'corridor.routeId', code: 'ROUTE_NOT_READY' }],
      }),
    );
    await newRace();
    await waitFor(() => expect(corridorSelect().options).toHaveLength(2));
    fireEvent.change(corridorSelect(), { target: { value: ROUTE_ID } });
    fireEvent.change(input(/^Допуск коридора, м/), { target: { value: '52' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать гонку' }));
    expect(await screen.findByText('Проверьте значение.')).toBeTruthy();
    expect(mocked.createRace).not.toHaveBeenCalled();

    fireEvent.change(input(/^Допуск коридора, м/), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать гонку' }));
    expect(await screen.findByText('Маршрут ещё обрабатывается или недоступен.')).toBeTruthy();
    expect(corridorSelect().getAttribute('aria-invalid')).toBe('true');
  });

  it('«Загрузить GPX» → окно «Новый маршрут» (название из имени файла) → «Обрабатываем маршрут…» → готов и выбран', async () => {
    const { queryClient } = await newRace();
    await waitFor(() => expect(corridorSelect().options).toHaveLength(2));
    const upload = screen.getByRole('button', { name: 'Загрузить GPX' });
    upload.focus();
    const file = chooseGpx();

    const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
    const title = within(dialog).getByLabelText(/^Название маршрута/) as HTMLInputElement;
    expect(title.value).toBe('Кольцо вокруг Минска');
    // окно — внутри формы гонки: вложенная форма в браузере отправила бы форму гонки (перезагрузка страницы)
    expect(document.querySelectorAll('form form')).toHaveLength(0);
    fireEvent.change(title, { target: { value: 'Новый круг' } });

    let resolveUpload: (value: PanelRoute) => void = () => undefined;
    mocked.uploadRoute.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Загрузить' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(mocked.uploadRoute).toHaveBeenCalledWith(file, 'Новый круг');

    const processing = route({
      id: NEW_ROUTE_ID,
      title: 'Новый круг',
      status: 'processing',
      distanceM: null,
      elevationGainM: null,
      isLoop: null,
      line: [],
    });
    mocked.getRoute.mockResolvedValue(processing);
    await act(async () => resolveUpload(processing));
    expect(screen.queryByRole('dialog', { name: 'Новый маршрут' })).toBeNull();
    expect((await screen.findByText('Обрабатываем маршрут…')).getAttribute('role')).toBe('status');

    const ready = route({ id: NEW_ROUTE_ID, title: 'Новый круг', distanceM: 62_049 });
    mocked.getRoute.mockResolvedValue(ready);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'routes', 'item', NEW_ROUTE_ID] });
    });
    // список готовых ещё старый — выбранный маршрут всё равно вариант поля
    await waitFor(() => expect(corridorSelect().value).toBe(NEW_ROUTE_ID));
    expect(corridorSelect().selectedOptions[0]?.textContent).toBe('Новый круг');
    await waitFor(() => expect(mocked.listRoutes).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Обрабатываем маршрут…')).toBeNull();
    await waitFor(() =>
      expect(text(screen.getByRole('status', { name: 'Дистанция, км' }).textContent)).toBe(
        '62,0 км — по маршруту',
      ),
    );
  });

  it('отказ разбора — причина под полем и «Загрузить другой файл»; 415 — текст в окне; > 5 МБ — без запроса', async () => {
    const { queryClient } = await newRace();
    await waitFor(() => expect(corridorSelect().options).toHaveLength(2));

    chooseGpx('big.gpx', 5 * 1024 * 1024 + 1);
    const big = await screen.findByRole('dialog', { name: 'Новый маршрут' });
    expect(within(big).getByText('Файл больше 5 МБ')).toBeTruthy();
    fireEvent.click(within(big).getByRole('button', { name: 'Загрузить' }));
    expect(mocked.uploadRoute).not.toHaveBeenCalled();
    fireEvent.click(within(big).getByRole('button', { name: /Отмена/ }));

    mocked.uploadRoute.mockRejectedValueOnce(httpError(415, 'ROUTE_FORMAT_UNSUPPORTED'));
    chooseGpx('track.fit');
    const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
    // Enter в названии — та же отправка
    fireEvent.keyDown(within(dialog).getByLabelText(/^Название маршрута/), { key: 'Enter' });
    expect(await within(dialog).findByText('Выберите файл GPX')).toBeTruthy();

    const processing = route({ id: NEW_ROUTE_ID, status: 'processing', line: [] });
    mocked.uploadRoute.mockResolvedValue(processing);
    mocked.getRoute.mockResolvedValue(processing);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await screen.findByText('Обрабатываем маршрут…');

    mocked.getRoute.mockResolvedValue(
      route({ id: NEW_ROUTE_ID, status: 'failed', failure: 'too_short', line: [] }),
    );
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'routes', 'item', NEW_ROUTE_ID] });
    });
    expect(await screen.findByText('Маршрут короче 1 км')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Загрузить другой файл' })).toBeTruthy();
    expect(corridorSelect().value).toBe('');
  });

  it('список маршрутов: скелетон, ошибка с повтором («Нет соединения» для сети), пусто — только «Без коридора»', async () => {
    mocked.listRoutes.mockReturnValue(new Promise(() => undefined));
    await renderApp('/races/new');
    await screen.findByRole('heading', { name: 'Новая гонка', level: 1 });
    expect(
      screen.getByText('Эталонный коридор').closest('.field')?.querySelector('.skeleton'),
    ).toBeTruthy();
    cleanup();

    mocked.listRoutes.mockRejectedValueOnce(networkError());
    await renderApp('/races/new');
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    mocked.listRoutes.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Не удалось загрузить маршруты')).toBeTruthy();
    mocked.listRoutes.mockResolvedValueOnce({ items: [], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect([...corridorSelect().options].map((option) => option.textContent)).toEqual([
        'Без коридора',
      ]),
    );
    expect(screen.getByRole('button', { name: 'Загрузить GPX' })).toBeTruthy();
  });

  it('превью: ошибка обновления при показанной линии — линия остаётся, баннер с повтором', async () => {
    const { queryClient } = await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('img', { name: /Линия маршрута/ });
    mocked.getRoute.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(async () => {
      await queryClient
        .refetchQueries({ queryKey: ['admin', 'routes', 'item', ROUTE_ID] })
        .catch(() => undefined);
    });
    expect(await screen.findByText('Не удалось обновить маршрут')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Линия маршрута/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось обновить маршрут')).toBeNull());
  });

  it('готовые маршруты — все страницы списка, не только первые 100', async () => {
    const FAR_ID = '01890a5d-ac96-774b-bcce-b302099a8099';
    mocked.listRoutes.mockImplementation((params = {}) =>
      Promise.resolve(
        params.cursor === 'page-2'
          ? { items: [summary({ id: FAR_ID, title: 'Дальний маршрут' })], nextCursor: null }
          : { items: [summary()], nextCursor: 'page-2' },
      ),
    );
    await newRace();
    await waitFor(() =>
      expect([...corridorSelect().options].map((option) => option.textContent)).toEqual([
        'Без коридора',
        'Минское кольцо',
        'Дальний маршрут',
      ]),
    );
    expect(mocked.listRoutes).toHaveBeenCalledWith({ status: 'ready', limit: 100 });
    expect(mocked.listRoutes).toHaveBeenCalledWith({
      status: 'ready',
      limit: 100,
      cursor: 'page-2',
    });
  });

  it('тот же файл снова после снятия коридора — готовый маршрут выбирается снова', async () => {
    await newRace();
    await waitFor(() => expect(corridorSelect().options).toHaveLength(2));
    mocked.uploadRoute.mockResolvedValue(route());
    for (let round = 0; round < 2; round += 1) {
      chooseGpx('Минское кольцо.gpx');
      const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
      await waitFor(() => expect(corridorSelect().value).toBe(ROUTE_ID));
      fireEvent.change(corridorSelect(), { target: { value: '' } });
      expect(corridorSelect().value).toBe('');
    }
    expect(mocked.uploadRoute).toHaveBeenCalledTimes(2);
  });

  it('обработка дольше 5 мин — опрос прекращается, текст «проверьте позже»', async () => {
    const { queryClient } = await newRace();
    await waitFor(() => expect(corridorSelect().options).toHaveLength(2));
    const processing = route({ id: NEW_ROUTE_ID, status: 'processing', line: [] });
    mocked.uploadRoute.mockResolvedValue(processing);
    mocked.getRoute.mockResolvedValue(processing);
    chooseGpx();
    const dialog = await screen.findByRole('dialog', { name: 'Новый маршрут' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await screen.findByText('Обрабатываем маршрут…');

    const later = Date.now() + 6 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'routes', 'item', NEW_ROUTE_ID] });
    });
    expect(
      await screen.findByText(
        'Маршрут обрабатывается дольше обычного — проверьте позже или загрузите файл ещё раз',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Обрабатываем маршрут…')).toBeNull();
    const route_ = queryClient
      .getQueryCache()
      .find({ queryKey: ['admin', 'routes', 'item', NEW_ROUTE_ID] });
    const interval = route_?.observers[0]?.options.refetchInterval;
    expect(typeof interval === 'function' ? interval(route_!) : interval).toBe(false);
  });

  it('превью: ошибка загрузки маршрута — текст и повтор', async () => {
    mocked.getRoute.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });
    expect(await screen.findByText('Не удалось загрузить маршрут')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Повторить' })[0]!);
    expect(await screen.findByRole('img', { name: /Линия маршрута/ })).toBeTruthy();
  });
});

describe('зафиксированный коридор (AC4, V-11)', () => {
  it('editable без corridor — только чтение с замком, без загрузки; дистанция по маршруту; правка без коридора в запросе', async () => {
    mocked.getRace.mockResolvedValue(
      race({
        status: 'published',
        phase: 'open',
        editable: {
          fields: RACE_FIELDS.filter(
            (field) => !['windowStartsAt', 'corridor', 'distanceKm'].includes(field),
          ),
          canPublish: false,
          canCancel: true,
          canDiscard: false,
          reasons: ['window_open'],
        },
      }),
    );
    mocked.updateRace.mockResolvedValue(race({ version: 4 }));
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });

    const corridor = screen.getByRole('status', { name: /Эталонный коридор/ });
    expect(corridor.textContent).toBe('Минское кольцо');
    expect(screen.getAllByText('зафиксировано').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Загрузить GPX' })).toBeNull();
    expect(input(/^Допуск коридора, м/).readOnly).toBe(true);
    expect(text(screen.getByRole('status', { name: 'Дистанция, км' }).textContent)).toBe(
      '86,0 км — по маршруту',
    );
    expect(mocked.listRoutes).not.toHaveBeenCalled();

    fireEvent.change(input(/^Описание/), { target: { value: 'Новое описание' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    await waitFor(() =>
      expect(mocked.updateRace).toHaveBeenCalledWith(RACE_ID, {
        version: 3,
        description: 'Новое описание',
      }),
    );
  });

  it('снять коридор у черновика — поле дистанции снова редактируемое, в запросе corridor: null', async () => {
    mocked.updateRace.mockResolvedValue(race({ corridor: null, version: 4 }));
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });
    await waitFor(() => expect(corridorSelect().value).toBe(ROUTE_ID));
    fireEvent.change(corridorSelect(), { target: { value: '' } });
    // сервер ещё считает дистанцию вычисляемой (`editable` без distanceKm), но коридор снят в форме — поле открыто
    expect(input(/^Дистанция, км/).value).toBe('86');
    expect(input(/^Дистанция, км/).readOnly).toBe(false);
    expect(screen.queryByLabelText(/^Допуск коридора/)).toBeNull();
    fireEvent.change(input(/^Дистанция, км/), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    await waitFor(() =>
      expect(mocked.updateRace).toHaveBeenCalledWith(RACE_ID, {
        version: 3,
        distanceKm: 90,
        corridor: null,
      }),
    );
  });
});
