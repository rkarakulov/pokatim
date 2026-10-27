// @vitest-environment jsdom
import type { PanelDispute } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, mountPanelCss, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listDisputes: vi.fn(),
    getDispute: vi.fn(),
    decideDispute: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a9001';
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const TARGET = '01890a5d-ac96-774b-bcce-b302099a0a01';
const COMPLAINANT = '01890a5d-ac96-774b-bcce-b302099a0b02';
const RIDER = '01890a5d-ac96-774b-bcce-b302099a0d04';

const dispute = (overrides: Partial<PanelDispute> = {}): PanelDispute => ({
  id: ID,
  race: { id: RACE_ID, title: 'Осенний коридор Заславль' },
  status: 'open',
  category: 'vehicle_assistance',
  targetEntryId: TARGET,
  complainantEntryId: COMPLAINANT,
  filedAt: '2026-10-26T07:00:00.000Z',
  decidableAt: '2026-10-26T19:00:00.000Z',
  responded: true,
  description: 'Скорость 60 км/ч на подъёме',
  response: { text: 'Ехал в группе', at: '2026-10-26T08:00:00.000Z' },
  target: {
    entryId: TARGET,
    userId: RIDER,
    resultStatus: 'provisional',
    place: 2,
    tied: false,
    elapsedSec: 6123,
  },
  complainant: { entryId: COMPLAINANT, userId: RIDER },
  decision: null,
  events: [
    { kind: 'filed', actorKind: 'rider', at: '2026-10-26T07:00:00.000Z' },
    { kind: 'responded', actorKind: 'rider', at: '2026-10-26T08:00:00.000Z' },
  ],
  filingClosesAt: '2026-10-26T20:59:00.000Z',
  protocolPlannedAt: '2026-10-27T20:59:00.000Z',
  canDecide: true,
  decideBlockedBy: null,
  ...overrides,
});

const DECIDED: Partial<PanelDispute> = {
  status: 'upheld',
  canDecide: false,
  decideBlockedBy: 'not_open',
  decision: {
    outcome: 'upheld',
    template: 'vehicle_assistance',
    note: 'Пульс 90 на 60 км/ч',
    actor: { userId: USER_ID, displayName: 'Марк' },
    at: '2026-10-27T07:30:00.000Z',
  },
};

const open = () => renderApp(`/disputes/${ID}`);
const submit = () => screen.getByRole('button', { name: 'Принять решение' });
const reasonOf = (button: HTMLElement) =>
  document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent;

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.getDispute.mockResolvedValue(dispute());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Споры» — разбор (06, AC13)', () => {
  it('шапка, результат, заявление (заявитель ·xxxxxx, «Скрыт от участника»), ответ, история', async () => {
    await open();
    expect(
      await screen.findByRole('heading', { name: 'Похоже на помощь транспорта' }),
    ).toBeTruthy();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Споры' }).getAttribute('href')).toBe(
      '/admin/disputes',
    );
    expect(screen.getByText(/Осенний коридор Заславль/)).toBeTruthy();
    for (const text of [
      'На рассмотрении',
      'Участник ·9a0a01',
      '2',
      '1:42:03',
      'Предварительный',
      'Участник ·9a0b02',
      'Скрыт от участника',
      'Скорость 60 км/ч на подъёме',
      'Ехал в группе',
      'Спор подан',
      'Участник ответил',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
  });

  it('без описания и ответа — «Без описания», «Ответа нет»', async () => {
    mocked.getDispute.mockResolvedValue(
      dispute({ description: null, response: null, responded: false }),
    );
    await open();
    expect(await screen.findByText('Без описания')).toBeTruthy();
    expect(screen.getByText('Ответа нет')).toBeTruthy();
  });

  it('решение: шаблоны по исходу, без шаблона — неактивна с причиной; подтверждение → запрос и инвалидация', async () => {
    mocked.decideDispute.mockResolvedValue(dispute(DECIDED));
    await open();
    await screen.findByRole('heading', { name: 'Похоже на помощь транспорта' });
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(submit())).toBe('Выберите исход и причину для участников');
    fireEvent.click(submit());
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('Отклонить'));
    expect(screen.getByLabelText('Трек проверен — нарушений нет')).toBeTruthy();
    expect(screen.queryByLabelText('Есть признаки помощи транспорта')).toBeNull();

    fireEvent.click(screen.getByLabelText('Удовлетворить'));
    expect(
      screen.getByText(
        'Результат будет дисквалифицирован: строка уйдёт из таблицы, места пересчитаются.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Трек проверен — нарушений нет')).toBeNull();
    fireEvent.click(screen.getByLabelText('Есть признаки помощи транспорта'));
    fireEvent.change(screen.getByLabelText('Внутренняя заметка — видит только команда'), {
      target: { value: 'Пульс 90 на 60 км/ч' },
    });
    expect(submit().getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(submit());
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Результат будет дисквалифицирован. Решение окончательно.'),
    ).toBeTruthy();
    mocked.getDispute.mockResolvedValue(dispute(DECIDED));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Принять решение' }));
    await waitFor(() =>
      expect(mocked.decideDispute).toHaveBeenCalledWith(ID, {
        outcome: 'upheld',
        template: 'vehicle_assistance',
        note: 'Пульс 90 на 60 км/ч',
      }),
    );
    expect(await screen.findByText('Решение принял Марк, 27 октября 2026, 10:30')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Принять решение' })).toBeNull();
  });

  it('форма решения: у шаблона и заметки отступ от поля выше (B18)', async () => {
    mountPanelCss();
    await open();
    await screen.findByRole('heading', { name: 'Похоже на помощь транспорта' });
    fireEvent.click(screen.getByLabelText('Отклонить'));
    const template = screen.getByRole('group', { name: 'Причина для участников (обязательно)' });
    const note = screen
      .getByLabelText('Внутренняя заметка — видит только команда')
      .closest('.field')!;
    for (const block of [template, note]) {
      expect(getComputedStyle(block).marginTop).toBe('var(--inset-md)');
    }
  });

  it('пустая заметка не отправляется', async () => {
    mocked.decideDispute.mockResolvedValue(dispute({ ...DECIDED, status: 'rejected' }));
    await open();
    fireEvent.click(await screen.findByLabelText('Отклонить'));
    fireEvent.click(screen.getByLabelText('Недостаточно оснований для дисквалификации'));
    fireEvent.click(submit());
    expect(
      within(screen.getByRole('dialog')).getByText(
        'Результат останется без изменений. Решение окончательно.',
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Принять решение' }),
    );
    await waitFor(() =>
      expect(mocked.decideDispute).toHaveBeenCalledWith(ID, {
        outcome: 'rejected',
        template: 'insufficient_evidence',
      }),
    );
  });

  it('до decidableAt (D-25) — кнопка aria-disabled с причиной и датой', async () => {
    mocked.getDispute.mockResolvedValue(
      dispute({ canDecide: false, decideBlockedBy: 'too_early' }),
    );
    await open();
    await screen.findByRole('heading', { name: 'Похоже на помощь транспорта' });
    fireEvent.click(screen.getByLabelText('Отклонить'));
    fireEvent.click(screen.getByLabelText('Трек проверен — нарушений нет'));
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(submit())).toBe('Решение можно принять не раньше 26 октября 2026, 22:00');
    fireEvent.click(submit());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('409 DISPUTE_ACTION_BLOCKED — текст по reason в окне, разбор перечитан', async () => {
    mocked.decideDispute.mockRejectedValue(
      httpError(409, 'DISPUTE_ACTION_BLOCKED', {
        reason: 'too_early',
        availableAt: '2026-10-26T19:00:00.000Z',
      }),
    );
    await open();
    fireEvent.click(await screen.findByLabelText('Отклонить'));
    fireEvent.click(screen.getByLabelText('Трек проверен — нарушений нет'));
    fireEvent.click(submit());
    const calls = mocked.getDispute.mock.calls.length;
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Принять решение' }),
    );
    expect(
      await within(screen.getByRole('dialog')).findByText(
        'Решение можно принять не раньше 26 октября 2026, 22:00',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(mocked.getDispute.mock.calls.length).toBeGreaterThan(calls));
  });

  it('решённый — исход, шаблон, заметка, автор и время; панели решения нет', async () => {
    mocked.getDispute.mockResolvedValue(
      dispute({
        ...DECIDED,
        events: [
          ...dispute().events,
          { kind: 'decided', actorKind: 'staff', at: '2026-10-27T07:30:00.000Z' },
        ],
      }),
    );
    await open();
    expect(await screen.findByText('Решение принял Марк, 27 октября 2026, 10:30')).toBeTruthy();
    expect(screen.getAllByText('Удовлетворён').length).toBeGreaterThan(0);
    expect(screen.getByText('Есть признаки помощи транспорта')).toBeTruthy();
    expect(screen.getByText('Пульс 90 на 60 км/ч')).toBeTruthy();
    expect(screen.getByText('Принято решение')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Принять решение' })).toBeNull();
  });

  it('без disputes.decide панели решения нет', async () => {
    mocked.me.mockResolvedValue({
      ...ME.moderator,
      permissions: ME.moderator.permissions.filter(
        (permission) => permission !== 'disputes.decide',
      ),
    });
    await open();
    await screen.findByRole('heading', { name: 'Похоже на помощь транспорта' });
    expect(screen.queryByRole('button', { name: 'Принять решение' })).toBeNull();
    expect(screen.queryByLabelText('Удовлетворить')).toBeNull();
  });

  it('404 — «Спор не найден»; сеть — «Нет соединения»', async () => {
    mocked.getDispute.mockRejectedValueOnce(httpError(404, 'DISPUTE_NOT_FOUND'));
    await open();
    expect(await screen.findByText('Спор не найден')).toBeTruthy();
    cleanup();
    mocked.getDispute.mockRejectedValueOnce(networkError());
    await open();
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
  });
});
