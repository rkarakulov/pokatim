// @vitest-environment jsdom
import {
  type EventMaterialAdmin,
  type EventTicketingSettings,
  type PanelRace,
  RACE_FIELDS,
} from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    getRace: vi.fn(),
    getCalendarStart: vi.fn(),
    listCalendar: vi.fn(),
    getEventTicketing: vi.fn(),
    updateEventTicketing: vi.fn(),
    listEventTickets: vi.fn(),
    listEventMaterials: vi.fn(),
    createEventMaterial: vi.fn(),
    uploadEventMaterial: vi.fn(),
    updateEventMaterial: vi.fn(),
    deleteEventMaterial: vi.fn(),
    reorderEventMaterials: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const CAL_ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const M1 = '01890a5d-ac96-774b-bcce-b302099a8101';
const M2 = '01890a5d-ac96-774b-bcce-b302099a8102';

const race: PanelRace = {
  id: RACE_ID,
  status: 'published',
  phase: 'upcoming',
  title: 'Осенний коридор',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 64,
  description: null,
  windowStartsAt: '2026-10-18T21:00:00.000Z',
  windowEndsAt: '2026-10-25T20:59:00.000Z',
  protocolPlannedAt: '2026-10-27T20:59:00.000Z',
  season: null,
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
};

const settings = (overrides: Partial<EventTicketingSettings> = {}): EventTicketingSettings => ({
  kind: 'race',
  eventId: RACE_ID,
  enabled: false,
  startsAt: null,
  endsAt: null,
  place: null,
  address: null,
  instructions: null,
  capacity: null,
  version: 0,
  updatedAt: null,
  registeredCount: 0,
  activeTickets: 0,
  checkedIn: 0,
  ...overrides,
});

const material = (id: string, overrides: Partial<EventMaterialAdmin> = {}): EventMaterialAdmin => ({
  id,
  type: 'link',
  title: 'Положение',
  description: null,
  url: 'https://pokatim.by/rules',
  file: null,
  version: 1,
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
  mocked.getRace.mockResolvedValue(race);
  mocked.getEventTicketing.mockResolvedValue(settings());
  mocked.listEventMaterials.mockResolvedValue({ items: [], itemsLeft: 20, filesLeft: 10 });
  mocked.listEventTickets.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Билеты и материалы»: настройки (RC-T3, RC-T6)', () => {
  it('гонка: включение без старта — ошибка сервера под полем; подсказка окна гонки', async () => {
    mocked.updateEventTicketing.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'startsAt', code: 'REQUIRED' }] }),
    );
    await renderApp(`/races/${RACE_ID}/tickets`);
    const form = await screen.findByRole('form', { name: 'Билеты' });
    expect(screen.getByRole('heading', { name: 'Билеты и материалы' })).toBeTruthy();
    expect(within(form).getByText(/Внутри окна гонки: 19 октября 2026, 00:00/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Выдавать билеты' }));
    fireEvent.change(within(form).getByLabelText('Место'), { target: { value: 'Парк' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocked.updateEventTicketing).toHaveBeenCalledWith('race', RACE_ID, {
        enabled: true,
        startsAt: null,
        endsAt: null,
        place: 'Парк',
        address: '',
        instructions: '',
        version: 0,
      }),
    );
    const startsAt = within(form).getByLabelText(/Очный старт/);
    await waitFor(() => expect(startsAt.getAttribute('aria-invalid')).toBe('true'));
  });

  it('старт вне окна гонки — предупреждение (сервер проверит при сохранении)', async () => {
    await renderApp(`/races/${RACE_ID}/tickets`);
    const form = await screen.findByRole('form', { name: 'Билеты' });
    fireEvent.change(within(form).getByLabelText(/Очный старт/), {
      target: { value: '2026-11-05T10:00' },
    });
    expect(
      await within(form).findByText('Очный старт вне окна гонки — проверьте дату'),
    ).toBeTruthy();
  });

  it('выключение при выпущенных билетах — подтверждение с числом; 409 CONFLICT — «обновите»', async () => {
    mocked.getEventTicketing.mockResolvedValue(
      settings({
        enabled: true,
        startsAt: '2026-10-24T07:00:00.000Z',
        place: 'Парк',
        version: 2,
        activeTickets: 7,
      }),
    );
    mocked.updateEventTicketing.mockRejectedValue(httpError(409, 'CONFLICT'));
    await renderApp(`/races/${RACE_ID}/tickets`);
    const form = await screen.findByRole('form', { name: 'Билеты' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Выдавать билеты' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Выключить билеты?' });
    expect(within(dialog).getByText(/У 7 участников билеты станут недействительными/)).toBeTruthy();
    expect(mocked.updateEventTicketing).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выключить' }));
    await waitFor(() =>
      expect(mocked.updateEventTicketing).toHaveBeenCalledWith(
        'race',
        RACE_ID,
        expect.objectContaining({ enabled: false, version: 2 }),
      ),
    );
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
  });

  it('409 TICKETING_INVALID_STATE — баннер по причине', async () => {
    mocked.getEventTicketing.mockResolvedValue(
      settings({
        kind: 'calendar',
        eventId: CAL_ID,
        startsAt: '2026-11-01T07:00:00.000Z',
        place: 'Площадь',
        registeredCount: 12,
      }),
    );
    mocked.getCalendarStart.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    mocked.me.mockResolvedValue(ME.admin);
    mocked.updateEventTicketing.mockRejectedValue(
      httpError(409, 'TICKETING_INVALID_STATE', { reason: 'capacity_below_registered' }),
    );
    await renderApp(`/calendar/${CAL_ID}/tickets`);
    const form = await screen.findByRole('form', { name: 'Билеты' });
    // календарь: дата и место — из старта, только чтение; число мест и «Зарегистрировано»
    expect(within(form).getByText('1 ноября 2026, 10:00')).toBeTruthy();
    expect(within(form).getByText('Площадь')).toBeTruthy();
    expect(within(form).getByText('Зарегистрировано: 12')).toBeTruthy();
    expect(within(form).queryByLabelText(/Очный старт/)).toBeNull();
    fireEvent.change(within(form).getByLabelText('Мест (пусто — без лимита)'), {
      target: { value: '5' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocked.updateEventTicketing).toHaveBeenCalledWith(
        'calendar',
        CAL_ID,
        expect.objectContaining({ capacity: 5 }),
      ),
    );
    expect(await screen.findByText('Мест меньше, чем уже зарегистрировано.')).toBeTruthy();
  });

  it('403 — «Нет доступа»; 404 — «не найдено»; ошибка — повтор', async () => {
    mocked.getEventTicketing.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await renderApp(`/races/${RACE_ID}/tickets`);
    expect(await screen.findByText('Нет доступа к разделу')).toBeTruthy();
    cleanup();
    mocked.getEventTicketing.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await renderApp(`/races/${RACE_ID}/tickets`);
    expect(await screen.findByText('Событие не найдено или недоступно.')).toBeTruthy();
    cleanup();
    mocked.getEventTicketing.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    mocked.getEventTicketing.mockResolvedValue(settings());
    await renderApp(`/races/${RACE_ID}/tickets`);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('form', { name: 'Билеты' })).toBeTruthy();
  });
});

describe('ошибка перечитывания поверх данных (AGENTS.md §4.12)', () => {
  const settingsKey = ['admin', 'tickets', 'race', RACE_ID, 'settings'];
  const materialsKey = ['admin', 'tickets', 'race', RACE_ID, 'materials'];

  it('настройки: прежняя форма + баннер «Не удалось обновить данные» → «Повторить» — баннер снят', async () => {
    const { queryClient } = await renderApp(`/races/${RACE_ID}/tickets`);
    await screen.findByRole('form', { name: 'Билеты' });
    mocked.getEventTicketing.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(() => queryClient.invalidateQueries({ queryKey: settingsKey }));
    expect(await screen.findByText('Не удалось обновить данные')).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Билеты' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось обновить данные')).toBeNull());
    expect(screen.getByRole('form', { name: 'Билеты' })).toBeTruthy();
  });

  it('материалы: прежний список + баннер → «Повторить» — баннер снят', async () => {
    mocked.listEventMaterials.mockResolvedValue({
      items: [material(M1)],
      itemsLeft: 19,
      filesLeft: 10,
    });
    const { queryClient } = await renderApp(`/races/${RACE_ID}/tickets`);
    expect(await screen.findByText('Положение')).toBeTruthy();
    mocked.listEventMaterials.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(() => queryClient.invalidateQueries({ queryKey: materialsKey }));
    const region = screen.getByRole('region', { name: 'Материалы' });
    expect(await within(region).findByText('Не удалось обновить данные')).toBeTruthy();
    expect(within(region).getByText('Положение')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(within(region).queryByText('Не удалось обновить данные')).toBeNull(),
    );
    expect(within(region).getByText('Положение')).toBeTruthy();
  });

  it('блок «Билеты» на странице гонки: прежняя строка + повтор', async () => {
    mocked.getEventTicketing.mockResolvedValue(settings({ enabled: true, activeTickets: 4 }));
    const { queryClient } = await renderApp(`/races/${RACE_ID}`);
    const block = await screen.findByRole('region', { name: 'Билеты' });
    expect(await within(block).findByText('Билеты включены · участников: 4')).toBeTruthy();
    mocked.getEventTicketing.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(() => queryClient.invalidateQueries({ queryKey: settingsKey }));
    expect(await within(block).findByRole('alert')).toBeTruthy();
    expect(within(block).getByText('Билеты включены · участников: 4')).toBeTruthy();
    fireEvent.click(within(block).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(within(block).queryByRole('alert')).toBeNull());
    expect(within(block).getByText('Билеты включены · участников: 4')).toBeTruthy();
  });
});

describe('«Материалы» (AC9)', () => {
  it('пусто; добавить ссылку — запрос по контракту, список перечитывается', async () => {
    mocked.createEventMaterial.mockResolvedValue(material(M1));
    await renderApp(`/races/${RACE_ID}/tickets`);
    expect(await screen.findByText('Материалов пока нет')).toBeTruthy();
    expect(screen.getByText('Осталось: материалов — 20, PDF — 10')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить материал' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый материал' });
    fireEvent.change(within(dialog).getByLabelText('Название'), { target: { value: 'Положение' } });
    // ссылка обязательна для типа «Ссылка» — проверка до запроса
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Ссылка (https)').getAttribute('aria-invalid')).toBe(
        'true',
      ),
    );
    expect(mocked.createEventMaterial).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Ссылка (https)'), {
      target: { value: 'https://pokatim.by/rules' },
    });
    mocked.listEventMaterials.mockResolvedValue({
      items: [material(M1)],
      itemsLeft: 19,
      filesLeft: 10,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocked.createEventMaterial).toHaveBeenCalledWith('race', RACE_ID, {
        type: 'link',
        title: 'Положение',
        description: '',
        url: 'https://pokatim.by/rules',
      }),
    );
    expect(await screen.findByText('Положение')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('загрузка не-PDF — «Только PDF до 10 МБ» под файлом (415)', async () => {
    mocked.uploadEventMaterial.mockRejectedValue(httpError(415, 'MATERIAL_FILE_UNSUPPORTED'));
    await renderApp(`/races/${RACE_ID}/tickets`);
    await screen.findByText('Материалов пока нет');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['<html>'], 'Схема.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: 'Загрузить PDF' });
    expect((within(dialog).getByLabelText('Название') as HTMLInputElement).value).toBe('Схема');
    // метаданные загрузки — в query: описание короче, чем у правки (EVENT_MATERIAL_UPLOAD_DESCRIPTION_MAX)
    expect((within(dialog).getByLabelText('Описание') as HTMLTextAreaElement).maxLength).toBe(500);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await waitFor(() =>
      expect(mocked.uploadEventMaterial).toHaveBeenCalledWith('race', RACE_ID, file, {
        type: 'pdf',
        title: 'Схема',
        fileName: 'Схема.pdf',
      }),
    );
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toBe('Только PDF до 10 МБ');
  });

  it('«Выше»/«Ниже» шлют полный набор id; удаление — через подтверждение', async () => {
    const pdf = material(M2, {
      type: 'parking',
      title: 'Парковка',
      url: null,
      file: { id: 'f'.repeat(43), name: 'p.pdf', size: 1_258_291 },
    });
    mocked.listEventMaterials.mockResolvedValue({
      items: [material(M1), pdf],
      itemsLeft: 18,
      filesLeft: 9,
    });
    mocked.reorderEventMaterials.mockResolvedValue({
      items: [pdf, material(M1)],
      itemsLeft: 18,
      filesLeft: 9,
    });
    mocked.deleteEventMaterial.mockResolvedValue(undefined);
    await renderApp(`/races/${RACE_ID}/tickets`);
    expect(await screen.findByText(/PDF · 1,2 МБ/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Переместить «Положение» выше' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Переместить «Парковка» выше' }));
    await waitFor(() =>
      expect(mocked.reorderEventMaterials).toHaveBeenCalledWith('race', RACE_ID, { ids: [M2, M1] }),
    );
    const row = (await screen.findByText('Положение')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Удалить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить материал?' });
    expect(mocked.deleteEventMaterial).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(mocked.deleteEventMaterial).toHaveBeenCalledWith('race', RACE_ID, M1),
    );
  });

  it('загрузка: 400 по полю вне формы (fileName) — общий текст ошибки', async () => {
    mocked.uploadEventMaterial.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'fileName', code: 'TOO_LONG' }] }),
    );
    await renderApp(`/races/${RACE_ID}/tickets`);
    await screen.findByText('Материалов пока нет');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.7'], 'Схема.pdf', { type: 'application/pdf' })] },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Загрузить PDF' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    expect(
      await within(dialog).findByText('Не удалось сохранить. Повторите попытку.'),
    ).toBeTruthy();
  });

  it('удаление уже удалённого (404) — список перечитан, без «Не удалось сохранить»', async () => {
    mocked.listEventMaterials.mockResolvedValue({
      items: [material(M1)],
      itemsLeft: 19,
      filesLeft: 10,
    });
    mocked.deleteEventMaterial.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await renderApp(`/races/${RACE_ID}/tickets`);
    const row = (await screen.findByText('Положение')).closest('li')!;
    mocked.listEventMaterials.mockResolvedValue({ items: [], itemsLeft: 20, filesLeft: 10 });
    fireEvent.click(within(row).getByRole('button', { name: 'Удалить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить материал?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Материалов пока нет')).toBeTruthy();
    expect(screen.queryByText('Не удалось сохранить. Повторите попытку.')).toBeNull();
  });

  it('лимит — кнопки aria-disabled с причиной', async () => {
    mocked.listEventMaterials.mockResolvedValue({
      items: [material(M1)],
      itemsLeft: 0,
      filesLeft: 0,
    });
    await renderApp(`/races/${RACE_ID}/tickets`);
    const add = await screen.findByRole('button', { name: 'Добавить материал' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(add.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toBe('Достигнут предел — удалите ненужные материалы');
    fireEvent.click(add);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('«Участники» (tickets.checkin)', () => {
  it('строки: код, имя, группа, статус, отметка по Минску, письмо; «Показать ещё» по курсору', async () => {
    mocked.listEventTickets
      .mockResolvedValueOnce({
        items: [
          {
            code: '7XK2M9PQRT',
            status: 'checked_in',
            participantName: 'Анна К.',
            category: { kind: 'race', tier: 'start', groupKey: 'overall' },
            checkedInAt: '2026-10-24T06:30:00.000Z',
            emailState: 'sent',
          },
        ],
        nextCursor: M1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            code: 'AB12CD34EF',
            status: 'active',
            participantName: 'Участник · r***@gmail.com',
            category: null,
            checkedInAt: null,
            emailState: 'failed',
          },
        ],
        nextCursor: null,
      });
    await renderApp(`/races/${RACE_ID}/tickets`);
    const row = (await screen.findByRole('cell', { name: '7XK2M-9PQRT' })).closest('tr')!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      '7XK2M-9PQRT',
      'Анна К.',
      'Общий зачёт · START',
      'Отмечен',
      '24.10.2026, 09:30',
      'Отправлено',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('Не доставлено')).toBeTruthy();
    expect(mocked.listEventTickets).toHaveBeenLastCalledWith('race', RACE_ID, {
      limit: 50,
      cursor: M1,
    });
  });

  it('пусто — «Пока никто не зарегистрирован»; без права — секции нет', async () => {
    await renderApp(`/races/${RACE_ID}/tickets`);
    expect(await screen.findByText('Пока никто не зарегистрирован')).toBeTruthy();
    cleanup();
    mocked.me.mockResolvedValue({ ...ME.organizer, permissions: ['races.read', 'races.manage'] });
    await renderApp(`/races/${RACE_ID}/tickets`);
    await screen.findByRole('form', { name: 'Билеты' });
    expect(screen.queryByRole('region', { name: 'Участники' })).toBeNull();
    expect(mocked.listEventTickets).toHaveBeenCalledTimes(1);
  });
});

describe('блок «Билеты» на странице гонки (RC-C1)', () => {
  it('опубликованная гонка: «Билеты включены · участников: N» и ссылка на страницу билетов', async () => {
    mocked.getEventTicketing.mockResolvedValue(settings({ enabled: true, activeTickets: 4 }));
    const { router } = await renderApp(`/races/${RACE_ID}`);
    const block = await screen.findByRole('region', { name: 'Билеты' });
    expect(await within(block).findByText('Билеты включены · участников: 4')).toBeTruthy();
    fireEvent.click(within(block).getByRole('link', { name: 'Билеты и материалы' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/races/${RACE_ID}/tickets`));
  });

  it('нет сети и кэша (paused) — «Нет соединения» с повтором, а не скелетон', async () => {
    // первый запрос блока висит; сеть пропала, запрос сброшен — новая загрузка без данных на паузе
    mocked.getEventTicketing.mockReturnValueOnce(new Promise(() => {}));
    mocked.getEventTicketing.mockResolvedValue(settings({ enabled: true, activeTickets: 4 }));
    const { queryClient } = await renderApp(`/races/${RACE_ID}`);
    const block = await screen.findByRole('region', { name: 'Билеты' });
    expect(within(block).getByTestId('ticketing-summary-skeleton')).toBeTruthy();
    onlineManager.setOnline(false);
    try {
      await act(() =>
        queryClient.resetQueries({ queryKey: ['admin', 'tickets', 'race', RACE_ID, 'settings'] }),
      );
      const alert = await within(block).findByRole('alert');
      expect(within(alert).getByText(/Нет соединения/)).toBeTruthy();
      expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
      expect(within(block).queryByTestId('ticketing-summary-skeleton')).toBeNull();
    } finally {
      act(() => onlineManager.setOnline(true));
    }
    expect(await within(block).findByText('Билеты включены · участников: 4')).toBeTruthy();
  });
});
