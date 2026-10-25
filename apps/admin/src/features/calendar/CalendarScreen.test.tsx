// @vitest-environment jsdom
import type { PanelCalendarStart } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listCalendar: vi.fn(),
    createCalendarStart: vi.fn(),
    updateCalendarStart: vi.fn(),
    unpublishCalendarStart: vi.fn(),
    republishCalendarStart: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const HIDDEN = '01890a5d-ac96-774b-bcce-b302099a8091';

const start = (overrides: Partial<PanelCalendarStart> = {}): PanelCalendarStart => ({
  id: ID,
  status: 'published',
  title: 'Гран-при Минска',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: '08:00',
  discipline: 'road',
  city: 'Минск',
  place: null,
  distancesKm: [80, 120],
  registrationUrl: 'https://example.by/race',
  description: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  version: 0,
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.listCalendar.mockResolvedValue({
    items: [
      start(),
      start({
        id: HIDDEN,
        status: 'unpublished',
        title: 'Гравийный Браслав',
        startsOn: '2027-06-26',
        endsOn: '2027-06-27',
        discipline: 'gravel',
        city: 'Браслав',
        version: 2,
      }),
    ],
    nextCursor: null,
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const form = () => screen.getByRole('form', { name: 'Новая запись календаря' });
const field = (label: RegExp) => within(form()).getByLabelText(label);

describe('«Календарь» (AC12)', () => {
  it('таблица: дата (многодневные — диапазон), название, дисциплина, город, статус', async () => {
    await renderApp('/calendar');
    const row = (await screen.findByRole('cell', { name: 'Гравийный Браслав' })).closest('tr')!;
    expect(
      within(row)
        .getAllByRole('cell')
        .slice(0, 5)
        .map((cell) => cell.textContent),
    ).toEqual(['26 июня 2027 — 27 июня 2027', 'Гравийный Браслав', 'Гравий', 'Браслав', 'Снята']);
    expect(
      screen.getByRole('button', { name: 'Вернуть в календарь: Гравийный Браслав' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Снять с публикации: Гран-при Минска' }),
    ).toBeTruthy();
  });

  it('новая запись: http-ссылка — ошибка под полем; https — публикация с дистанциями числами', async () => {
    mocked.createCalendarStart.mockResolvedValue(start());
    await renderApp('/calendar');
    await screen.findByRole('cell', { name: 'Гран-при Минска' });
    fireEvent.change(field(/^Название/), { target: { value: 'Гран-при Минска' } });
    fireEvent.change(field(/^Дата\b/), { target: { value: '2027-06-14' } });
    fireEvent.change(field(/^Город/), { target: { value: 'Минск' } });
    fireEvent.change(field(/^Дистанция, км/), { target: { value: '80, 120' } });
    fireEvent.change(field(/^Ссылка на регистрацию/), { target: { value: 'http://example.by' } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Опубликовать' }));

    const error = await screen.findByText('Проверьте значение.');
    expect(field(/^Ссылка на регистрацию/).getAttribute('aria-describedby')).toContain(error.id);
    expect(mocked.createCalendarStart).not.toHaveBeenCalled();

    fireEvent.change(field(/^Ссылка на регистрацию/), {
      target: { value: 'https://example.by/race' },
    });
    fireEvent.click(within(form()).getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() =>
      expect(mocked.createCalendarStart).toHaveBeenCalledWith({
        title: 'Гран-при Минска',
        startsOn: '2027-06-14',
        endsOn: null,
        startTime: null,
        discipline: 'road',
        city: 'Минск',
        place: null,
        distancesKm: [80, 120],
        registrationUrl: 'https://example.by/race',
        description: null,
      }),
    );
  });

  it('«Снять с публикации» — причина обязательна; «Вернуть в календарь» — с версией', async () => {
    mocked.unpublishCalendarStart.mockResolvedValue(start({ status: 'unpublished', version: 1 }));
    mocked.republishCalendarStart.mockResolvedValue(start({ id: HIDDEN, version: 3 }));
    await renderApp('/calendar');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Снять с публикации: Гран-при Минска' }),
    );
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Снять с публикации' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText('Причина (обязательно)'), {
      target: { value: 'Старт перенесён организатором' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.unpublishCalendarStart).toHaveBeenCalledWith(ID, {
        version: 0,
        reason: 'Старт перенесён организатором',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в календарь: Гравийный Браслав' }));
    await waitFor(() =>
      expect(mocked.republishCalendarStart).toHaveBeenCalledWith(HIDDEN, { version: 2 }),
    );
  });

  it.each([
    ['80, abc', 'нечисловая'],
    ['80, 1001', 'вне диапазона'],
  ])('дистанция «%s» (%s) — ошибка под полем «Дистанция, км», без запроса', async (value) => {
    await renderApp('/calendar');
    await screen.findByRole('cell', { name: 'Гран-при Минска' });
    fireEvent.change(field(/^Название/), { target: { value: 'Гран-при Минска' } });
    fireEvent.change(field(/^Дата\b/), { target: { value: '2027-06-14' } });
    fireEvent.change(field(/^Город/), { target: { value: 'Минск' } });
    fireEvent.change(field(/^Дистанция, км/), { target: { value } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Опубликовать' }));

    const error = await within(form()).findByText('Проверьте значение.');
    expect(field(/^Дистанция, км/).getAttribute('aria-describedby')).toContain(error.id);
    expect(mocked.createCalendarStart).not.toHaveBeenCalled();
  });

  it('ошибка сервера с путём distancesKm.0 — под полем «Дистанция, км»', async () => {
    mocked.createCalendarStart.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'distancesKm.0', code: 'INVALID' }] }),
    );
    await renderApp('/calendar');
    await screen.findByRole('cell', { name: 'Гран-при Минска' });
    fireEvent.change(field(/^Название/), { target: { value: 'Гран-при Минска' } });
    fireEvent.change(field(/^Дата\b/), { target: { value: '2027-06-14' } });
    fireEvent.change(field(/^Город/), { target: { value: 'Минск' } });
    fireEvent.change(field(/^Дистанция, км/), { target: { value: '100' } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Опубликовать' }));

    const error = await within(form()).findByText('Проверьте значение.');
    expect(field(/^Дистанция, км/).getAttribute('aria-describedby')).toContain(error.id);
  });
});
