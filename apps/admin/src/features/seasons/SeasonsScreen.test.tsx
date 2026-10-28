// @vitest-environment jsdom
import type { PanelSeason } from '@pokatim/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    createSeason: vi.fn(),
    updateSeason: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const S2026 = '01890a5d-ac96-774b-bcce-b302099a8070';
const S2025 = '01890a5d-ac96-774b-bcce-b302099a8071';

const season = (overrides: Partial<PanelSeason>): PanelSeason => ({
  id: S2026,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
  raceCount: 7,
  version: 0,
  ...overrides,
});
const SEASONS = [
  season({}),
  season({
    id: S2025,
    name: 'Сезон 2025',
    startsOn: '2025-04-01',
    endsOn: '2025-10-31',
    phase: 'finished',
    raceCount: 9,
  }),
];

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.listSeasons.mockResolvedValue({ items: SEASONS });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const form = () => screen.getByRole('form', { name: 'Новый сезон' });
const field = (name: RegExp) => within(form()).getByLabelText(name);

describe('«Сезоны» (AC10)', () => {
  it('загрузка — скелетон под видимой шапкой и формой', async () => {
    mocked.listSeasons.mockReturnValue(new Promise(() => undefined));
    await renderApp('/seasons');
    expect(await screen.findByRole('heading', { name: 'Сезоны', level: 1 })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Гонок' })).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(8);
  });

  it('таблица: сезон, начало, конец (даты Минска), гонок, статус-метка; форма справа', async () => {
    await renderApp('/seasons');
    const row = (await screen.findByRole('cell', { name: 'Сезон 2026' })).closest('tr')!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Сезон 2026', '1 апреля 2026', '31 октября 2026', '7', 'Текущий', 'Изменить']);
    expect(screen.getByText(/Сезонный рейтинг считается по гонкам/)).toBeTruthy();
    expect(within(form()).getAllByText('Europe/Minsk')).toHaveLength(2);
  });

  it('название сезона — ссылка на экран сезона (08b)', async () => {
    await renderApp('/seasons');
    const link = await screen.findByRole('link', { name: 'Сезон 2026' });
    expect(link.getAttribute('href')).toBe(`/admin/seasons/${S2026}`);
  });

  it('пересечение — ошибка под полем с названием и датами сезона, «Создать сезон» неактивна с причиной', async () => {
    await renderApp('/seasons');
    await screen.findByRole('cell', { name: 'Сезон 2026' });
    fireEvent.change(field(/^Название/), { target: { value: 'Зимний сезон 2026/27' } });
    fireEvent.change(field(/^Начало/), { target: { value: '2026-10-15' } });
    fireEvent.change(field(/^Конец/), { target: { value: '2027-03-31' } });

    const error = await screen.findByText(
      'Даты пересекаются с «Сезон 2026» (1 апреля 2026 — 31 октября 2026). Сезоны не могут пересекаться.',
    );
    expect(field(/^Начало/).getAttribute('aria-describedby')).toContain(error.id);
    const submit = within(form()).getByRole('button', { name: 'Создать сезон' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(submit.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toBe('Недоступно: исправьте даты');
    fireEvent.click(submit);
    // дождаться асинхронной проверки формы (handleSubmit) без таймеров
    await act(async () => undefined);
    expect(mocked.createSeason).not.toHaveBeenCalled();
  });

  it('создание: тело по контракту; ошибка сервера — под полем', async () => {
    mocked.createSeason.mockRejectedValueOnce(
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'endsOn', code: 'SEASON_IN_PAST' }] }),
    );
    await renderApp('/seasons');
    await screen.findByRole('cell', { name: 'Сезон 2026' });
    fireEvent.change(field(/^Название/), { target: { value: 'Сезон 2027' } });
    fireEvent.change(field(/^Начало/), { target: { value: '2027-04-01' } });
    fireEvent.change(field(/^Конец/), { target: { value: '2027-10-31' } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Создать сезон' }));

    expect(await screen.findByText('Сезон целиком в прошлом.')).toBeTruthy();
    expect(mocked.createSeason).toHaveBeenCalledWith({
      name: 'Сезон 2027',
      startsOn: '2027-04-01',
      endsOn: '2027-10-31',
    });
  });

  it('завершённый: «Изменить» — даты только для чтения, имя меняется; 409 — баннер с «Обновить»', async () => {
    mocked.updateSeason.mockRejectedValueOnce(httpError(409, 'CONFLICT'));
    await renderApp('/seasons');
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить: Сезон 2025' }));
    const edit = screen.getByRole('form', { name: 'Изменить: Сезон 2025' });
    expect((within(edit).getByLabelText(/^Начало/) as HTMLInputElement).disabled).toBe(true);
    expect(within(edit).getAllByText('зафиксировано')).toHaveLength(2);
    fireEvent.change(within(edit).getByLabelText(/^Название/), { target: { value: 'Архив 2025' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
    expect(mocked.updateSeason).toHaveBeenCalledWith(S2025, { version: 0, name: 'Архив 2025' });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(mocked.listSeasons).toHaveBeenCalledTimes(2));
  });

  it('без seasons.manage (модератор, организатор) — таблица без кнопок и формы', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/seasons');
    await screen.findByRole('cell', { name: 'Сезон 2026' });
    expect(screen.queryByRole('button', { name: /Изменить/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Новый сезон' })).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('ошибка загрузки — «Не удалось загрузить» с повтором', async () => {
    mocked.listSeasons.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/seasons');
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
