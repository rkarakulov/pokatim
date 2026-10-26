// @vitest-environment jsdom
import { RACE_FIELDS, type PanelRace, type PanelSeason } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    listRaces: vi.fn(),
    getRace: vi.fn(),
    createRace: vi.fn(),
    updateRace: vi.fn(),
    publishRace: vi.fn(),
    cancelRace: vi.fn(),
    discardRace: vi.fn(),
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
  surfaces: ['asphalt', 'gravel'],
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
  mocked.listSeasons.mockResolvedValue({ items: [SEASON] });
  mocked.listRoutes.mockResolvedValue({ items: [], nextCursor: null });
  mocked.listRaces.mockResolvedValue({ items: [race()], nextCursor: null });
  mocked.getRace.mockResolvedValue(race());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe('«Гонки» — список (AC11)', () => {
  it('таблица: название, класс, окно по Минску, сезон, статус, организатор', async () => {
    await renderApp('/races');
    const row = (await screen.findByRole('link', { name: 'Осенний коридор Заславль' })).closest(
      'tr',
    )!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Осенний коридор Заславль',
      'Шоссе',
      '19 октября 2026, 00:00 — 25 октября 2026, 23:59',
      'Сезон 2026',
      'Скоро',
      'Ира',
    ]);
    expect(screen.getByRole('link', { name: 'Новая гонка' })).toBeTruthy();
  });

  it('фильтры — в URL и в запросе; «Мои»; «Показать ещё» по курсору', async () => {
    mocked.listRaces
      .mockResolvedValueOnce({ items: [race()], nextCursor: 'c1' })
      .mockResolvedValue({ items: [], nextCursor: null });
    const { router } = await renderApp('/races');
    await screen.findByRole('link', { name: 'Осенний коридор Заславль' });

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    await waitFor(() =>
      expect(mocked.listRaces).toHaveBeenLastCalledWith({ limit: 50, cursor: 'c1' }),
    );

    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'draft' } });
    await waitFor(() => expect(currentHref(router)).toContain('status=draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Мои' }));
    await waitFor(() => expect(currentHref(router)).toContain('mine=true'));
    await waitFor(() =>
      expect(mocked.listRaces).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'draft', mine: true, limit: 50 }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Мои' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('фильтр сезона: загрузка — скелетон на месте вариантов (гонки уже видны)', async () => {
    mocked.listSeasons.mockReturnValue(new Promise(() => undefined));
    await renderApp('/races');
    await screen.findByRole('link', { name: 'Осенний коридор Заславль' });
    expect(screen.getByTestId('skeleton-season-filter')).toBeTruthy();
    expect(screen.queryByLabelText('Сезон')).toBeNull();
  });

  it('отказ listSeasons при успешном listRaces — ошибка с повтором; повтор — варианты сезонов', async () => {
    mocked.listSeasons.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp('/races');
    await screen.findByRole('link', { name: 'Осенний коридор Заславль' });
    expect(await screen.findByText('Не удалось загрузить сезоны')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку сезонов' }));
    const select = await screen.findByLabelText('Сезон');
    expect(within(select).getByRole('option', { name: 'Сезон 2026' })).toBeTruthy();
  });

  it('ошибка обновления сезонов при загруженных вариантах — варианты остаются, баннер с повтором', async () => {
    const { queryClient } = await renderApp('/races');
    await screen.findByRole('link', { name: 'Осенний коридор Заславль' });
    await screen.findByRole('option', { name: 'Сезон 2026' });
    mocked.listSeasons.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'seasons'] }).catch(() => undefined);
    });
    expect(await screen.findByText('Не удалось обновить список сезонов')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Сезон 2026' })).toBeTruthy();
  });

  it('фаза «Протокол опубликован» (final) — метка успеха', async () => {
    mocked.listRaces.mockResolvedValue({ items: [race({ phase: 'final' })], nextCursor: null });
    await renderApp('/races');
    const tag = await screen.findByText('Протокол опубликован');
    expect(tag.className).toContain('status-tag--success');
  });

  it('модератор — без «Новая гонка»', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/races');
    await screen.findByRole('link', { name: 'Осенний коридор Заславль' });
    expect(screen.queryByRole('link', { name: 'Новая гонка' })).toBeNull();
  });
});

describe('«Новая гонка» (AC11, AC13)', () => {
  async function fill() {
    await renderApp('/races/new');
    await screen.findByRole('heading', { name: 'Новая гонка', level: 1 });
    fireEvent.change(input(/^Название/), { target: { value: 'Осенний коридор Заславль' } });
    fireEvent.click(screen.getByRole('button', { name: 'Асфальт' }));
    fireEvent.change(input(/^Дистанция, км/), { target: { value: '64,5' } });
    fireEvent.change(input(/^Окно: начало/), { target: { value: '2026-10-19T00:00' } });
    fireEvent.change(input(/^Окно: конец/), { target: { value: '2026-10-25T23:59' } });
  }

  it('одна колонка: группы, метки Europe/Minsk, чипы покрытия, вычисляемый сезон только для чтения', async () => {
    await fill();
    expect(screen.getByRole('heading', { name: 'Гонка' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Окно и протокол' })).toBeTruthy();
    expect(screen.getAllByText('Europe/Minsk')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Асфальт' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('status', { name: 'Сезон (по концу окна)' }).textContent).toBe(
      'Сезон 2026 · 1 апреля 2026 — 31 октября 2026',
    );
  });

  it('правило 48 ч: ошибка с ближайшей датой, «Создать гонку» неактивна с причиной; позже — уходит в UTC', async () => {
    mocked.createRace.mockResolvedValue(race({ status: 'draft', phase: 'draft' }));
    await fill();
    fireEvent.change(input(/^Плановая дата протокола/), { target: { value: '2026-10-26T12:00' } });

    expect(
      await screen.findByText(
        'Протокол — не раньше чем через 48 ч после конца окна: 27 октября 2026, 23:59 или позже.',
      ),
    ).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Создать гонку' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(submit.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Недоступно: исправьте ошибки в полях',
    );

    fireEvent.change(input(/^Плановая дата протокола/), { target: { value: '2026-10-27T23:59' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocked.createRace).toHaveBeenCalledWith({
        title: 'Осенний коридор Заславль',
        bikeClass: 'road',
        surfaces: ['asphalt'],
        distanceKm: 64.5,
        description: null,
        windowStartsAt: '2026-10-18T21:00:00Z',
        windowEndsAt: '2026-10-25T20:59:00Z',
        protocolPlannedAt: '2026-10-27T20:59:00Z',
        corridor: null,
      }),
    );
    await waitFor(() => expect(mocked.getRace).toHaveBeenCalledWith(RACE_ID));
  });

  it('ошибки сервера — под полями', async () => {
    mocked.createRace.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', {
        fields: [{ path: 'windowEndsAt', code: 'DATE_ORDER' }],
      }),
    );
    await fill();
    fireEvent.change(input(/^Плановая дата протокола/), { target: { value: '2026-10-30T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать гонку' }));
    const error = await screen.findByText('Конец не может быть раньше начала.');
    expect(input(/^Окно: конец/).getAttribute('aria-describedby')).toContain(error.id);
  });
});

describe('«Редактирование» (AC11)', () => {
  it('окно открыто: начало зафиксировано с замком, причина; сохранение — только изменённое с версией', async () => {
    const open = race({
      phase: 'open',
      editable: {
        fields: RACE_FIELDS.filter((field) => field !== 'windowStartsAt'),
        canPublish: false,
        canCancel: true,
        canDiscard: false,
        reasons: ['window_open'],
      },
    });
    mocked.getRace.mockResolvedValue(open);
    mocked.updateRace.mockResolvedValue({ ...open, title: 'Новое имя', version: 4 });
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });

    expect(input(/^Окно: начало/).disabled).toBe(true);
    expect(screen.getByText('зафиксировано')).toBeTruthy();
    expect(screen.getByText('Окно открыто: начало окна зафиксировано.')).toBeTruthy();
    expect(screen.getByText(/Окно ещё открыто: дата может быть раньше текущей/)).toBeTruthy();

    fireEvent.change(input(/^Название/), { target: { value: 'Новое имя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    await waitFor(() =>
      expect(mocked.updateRace).toHaveBeenCalledWith(RACE_ID, { version: 3, title: 'Новое имя' }),
    );
  });

  it('окно закрыто: протокол только позже — ошибка с текущей датой', async () => {
    mocked.getRace.mockResolvedValue(
      race({
        phase: 'closed',
        editable: {
          fields: ['description', 'protocolPlannedAt'],
          canPublish: false,
          canCancel: true,
          canDiscard: false,
          reasons: ['window_closed'],
        },
      }),
    );
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });
    expect((input(/^Название/) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(input(/^Плановая дата протокола/), { target: { value: '2026-10-27T23:00' } });
    expect(
      await screen.findByText(
        'Окно гонки закрыто — дату протокола можно перенести только позже: 27 октября 2026, 23:59 или позже.',
      ),
    ).toBeTruthy();
  });

  it('409 при сохранении — баннер «Запись изменили — обновите страницу», «Обновить» перечитывает', async () => {
    mocked.updateRace.mockRejectedValue(httpError(409, 'CONFLICT'));
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль', level: 1 });
    fireEvent.change(input(/^Описание/), { target: { value: 'Правка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(mocked.getRace).toHaveBeenCalledTimes(2));
  });

  it('«Отменить гонку?»: радиогруппа шаблонов, превью, подтверждение неактивно без выбора', async () => {
    mocked.cancelRace.mockResolvedValue(
      race({ status: 'cancelled', phase: 'cancelled', cancelReason: 'weather', version: 4 }),
    );
    await renderApp(`/races/${RACE_ID}`);
    const trigger = await screen.findByRole('button', { name: 'Отменить гонку' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        'Гонка будет отменена для всех, причина появится в карточке гонки. Отменить это действие нельзя.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    const confirm = within(dialog).getByRole('button', { name: 'Отменить гонку' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(
      within(dialog).getByRole('radio', { name: 'Неблагоприятные погодные условия' }),
    );
    expect(
      within(dialog).getByText(
        'Участники увидят «Гонка отменена. Причина: неблагоприятные погодные условия.»',
      ),
    ).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.cancelRace).toHaveBeenCalledWith(RACE_ID, { version: 3, reason: 'weather' }),
    );
  });

  it('черновик вне сезона: «Опубликовать» неактивна с причиной; удаление черновика — подтверждение', async () => {
    mocked.getRace.mockResolvedValue(
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
      }),
    );
    mocked.discardRace.mockResolvedValue(undefined);
    const { router } = await renderApp(`/races/${RACE_ID}`);
    const publish = await screen.findByRole('button', { name: 'Опубликовать' });
    expect(publish.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(publish.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Опубликовать нельзя: конец окна не попадает ни в один сезон.',
    );
    fireEvent.click(publish);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить черновик' }),
    );
    await waitFor(() => expect(mocked.discardRace).toHaveBeenCalledWith(RACE_ID, { version: 3 }));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/races'));
  });

  it('опубликованный протокол (D-19): причина results_final, ссылка «Результаты», без «Отменить гонку»', async () => {
    mocked.getRace.mockResolvedValue(
      race({
        phase: 'final',
        editable: {
          fields: ['description'],
          canPublish: false,
          canCancel: false,
          canDiscard: false,
          reasons: ['results_final'],
        },
      }),
    );
    await renderApp(`/races/${RACE_ID}`);
    expect(
      await screen.findByText(
        'Протокол опубликован: можно изменить только описание; отмена гонки недоступна (D-19).',
      ),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Результаты' });
    expect(link.getAttribute('href')).toBe(`/admin/races/${RACE_ID}/results`);
    expect(screen.queryByRole('button', { name: 'Отменить гонку' })).toBeNull();
  });

  it('открытые споры (D-19, 06): причина disputes_open, без «Отменить гонку»', async () => {
    mocked.getRace.mockResolvedValue(
      race({
        phase: 'closed',
        editable: {
          fields: ['description'],
          canPublish: false,
          canCancel: false,
          canDiscard: false,
          reasons: ['window_closed', 'disputes_open'],
        },
      }),
    );
    await renderApp(`/races/${RACE_ID}`);
    expect(
      await screen.findByText('По гонке есть открытые споры — отмена недоступна (D-19).'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отменить гонку' })).toBeNull();
  });

  it('409 RACE_INVALID_STATE disputes_open при отмене — текст причины в окне', async () => {
    mocked.cancelRace.mockRejectedValue(
      httpError(409, 'RACE_INVALID_STATE', { reason: 'disputes_open' }),
    );
    await renderApp(`/races/${RACE_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить гонку' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('radio', { name: 'Неблагоприятные погодные условия' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отменить гонку' }));
    expect(
      await within(dialog).findByText('По гонке есть открытые споры — отмена недоступна (D-19).'),
    ).toBeTruthy();
  });

  it('черновик — без ссылки «Результаты»', async () => {
    mocked.getRace.mockResolvedValue(race({ status: 'draft', phase: 'draft', publishedAt: null }));
    await renderApp(`/races/${RACE_ID}`);
    await screen.findByRole('heading', { name: 'Осенний коридор Заславль' });
    expect(screen.queryByRole('link', { name: 'Результаты' })).toBeNull();
  });

  it('чужая или несуществующая гонка (404) — «не найдена»', async () => {
    mocked.getRace.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await renderApp(`/races/${RACE_ID}`);
    expect(await screen.findByText('Гонка не найдена или недоступна.')).toBeTruthy();
  });
});
