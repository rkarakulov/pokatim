// @vitest-environment jsdom
import {
  RACE_FIELDS,
  type PanelRace,
  type PanelRaceAttempt,
  type PanelRaceResults,
  type PanelStandingRow,
} from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    getRaceResultsSummary: vi.fn(),
    getRaceStandings: vi.fn(),
    listRaceAttempts: vi.fn(),
    listProtocolRecalculations: vi.fn(),
    excludeAttempt: vi.fn(),
    restoreAttempt: vi.fn(),
    recheckRaceResults: vi.fn(),
    publishProtocol: vi.fn(),
    disqualifyResult: vi.fn(),
    revokeDisqualification: vi.fn(),
    recheckProtocol: vi.fn(),
    applyProtocolRecheck: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const ENTRY_A = '01890a5d-ac96-774b-bcce-b302099a0a01';
const ENTRY_B = '01890a5d-ac96-774b-bcce-b302099a0b02';
const ATTEMPT_ID = '01890a5d-ac96-774b-bcce-b302099a0c03';
const USER_A = '01890a5d-ac96-774b-bcce-b302099a0d04';
const REASON = 'Трек записан чужим устройством';

const race = (overrides: Partial<PanelRace> = {}): PanelRace => ({
  id: RACE_ID,
  status: 'published',
  phase: 'closed',
  title: 'Осенний коридор Заславль',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 64,
  description: '',
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
  ...overrides,
});

const CHECKS_EMPTY: PanelRaceResults['publish']['checklist'] = [
  { code: 'open_disputes', count: 0 },
  { code: 'unprocessed_tracks', count: 0 },
  { code: 'checks_queued', count: 0 },
  { code: 'checks_failed', count: 0 },
  { code: 'window_open', count: 0 },
];

const summary = (overrides: Partial<PanelRaceResults> = {}): PanelRaceResults => ({
  raceId: RACE_ID,
  lockedAt: '2026-10-19T08:00:00.000Z',
  engineVersion: 2,
  counts: {
    entries: 14,
    active: 12,
    withdrawn: 2,
    ranked: 9,
    attempts: {
      queued: 1,
      checking: 2,
      counted: 9,
      rejected: 4,
      failed: 1,
      withdrawn: 0,
      excluded: 3,
    },
    hidden: 0,
    failed: 1,
    staleEngine: 0,
  },
  phase: 'closed',
  uploadClosesAt: '2026-10-26T20:59:00.000Z',
  protocol: null,
  recheck: null,
  publish: {
    canPublish: false,
    blockedBy: null,
    checklist: CHECKS_EMPTY.map((check) =>
      check.code === 'checks_failed' ? { ...check, count: 1 } : check,
    ),
  },
  ...overrides,
});

const PUBLISHED: Partial<PanelRaceResults> = {
  phase: 'final',
  protocol: {
    publishedAt: '2026-10-27T09:00:00.000Z',
    revision: 2,
    ranked: 8,
    disqualified: 1,
    recheckPending: false,
  },
  publish: { canPublish: false, blockedBy: 'published', checklist: CHECKS_EMPTY },
};

const row = (overrides: Partial<PanelStandingRow> = {}): PanelStandingRow => ({
  entryId: ENTRY_A,
  userId: USER_A,
  entryStatus: 'active',
  resultStatus: 'provisional',
  place: 2,
  tied: true,
  elapsedSec: 6123,
  bestAttemptId: ATTEMPT_ID,
  summary: { total: 3, pending: 0, counted: 2, rejectedShown: 1, failed: 0, excluded: 0 },
  ...overrides,
});

const attempt = (overrides: Partial<PanelRaceAttempt> = {}): PanelRaceAttempt => ({
  id: ATTEMPT_ID,
  entryId: ENTRY_A,
  userId: USER_A,
  activityId: '01890a5d-ac96-774b-bcce-b302099a0e05',
  origin: 'explicit',
  status: 'failed',
  hidden: false,
  reasons: [],
  failure: 'timeout',
  withdrawReason: null,
  segment: null,
  engineVersion: 2,
  checkRevision: 1,
  checkAttempts: 3,
  diagnostics: null,
  createdAt: '2026-10-20T07:15:00.000Z',
  checkedAt: null,
  review: null,
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.getRace.mockResolvedValue(race());
  mocked.getRaceResultsSummary.mockResolvedValue(summary());
  mocked.getRaceStandings.mockResolvedValue({
    source: 'live',
    revision: null,
    truncated: false,
    items: [row()],
  });
  mocked.listRaceAttempts.mockResolvedValue({ items: [attempt()], nextCursor: null });
  mocked.listProtocolRecalculations.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const PATH = `/races/${RACE_ID}/results`;
const tile = (label: string) => screen.getByRole('group', { name: label });
const section = (name: string) => screen.getByRole('region', { name });
const reasonField = () => screen.getByLabelText(/Причина/) as HTMLTextAreaElement;

describe('«Результаты» гонки — загрузка и ошибки', () => {
  it('загрузка: заголовок и подписи KPI видны, вместо чисел — скелетон', async () => {
    mocked.getRaceResultsSummary.mockReturnValue(new Promise(() => undefined));
    await renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Осенний коридор Заславль' })).toBeTruthy();
    expect(tile('Участники').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByTestId('skeleton-stat')).toHaveLength(6);
  });

  it('нет сети — «Нет соединения» с повтором; повтор — данные', async () => {
    mocked.getRaceResultsSummary.mockRejectedValueOnce(networkError());
    await renderApp(PATH);
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('group', { name: 'Участники' })).toBeTruthy();
    await waitFor(() => expect(within(tile('Участники')).getByText('12')).toBeTruthy());
  });

  it('ответ сервера с ошибкой — «Не удалось загрузить»; 404 — «не найдена»', async () => {
    mocked.getRaceResultsSummary.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp(PATH);
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
    cleanup();
    mocked.getRaceResultsSummary.mockRejectedValueOnce(httpError(404, 'NOT_FOUND'));
    await renderApp(PATH);
    expect(await screen.findByText('Гонка не найдена или недоступна.')).toBeTruthy();
  });

  it('ошибка обновления при показанных данных — данные остаются, баннер с повтором', async () => {
    const { queryClient } = await renderApp(PATH);
    await waitFor(() => expect(within(tile('Участники')).getByText('12')).toBeTruthy());
    mocked.getRaceResultsSummary.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await queryClient.refetchQueries({ queryKey: ['admin', 'races', 'item', RACE_ID, 'results'] });
    expect(await screen.findByText('Не удалось обновить результаты')).toBeTruthy();
    expect(within(tile('Участники')).getByText('12')).toBeTruthy();
  });
});

describe('«Результаты» гонки — до публикации', () => {
  it('KPI: участники, в зачёте, на проверке, отказы, сбои, исключено', async () => {
    await renderApp(PATH);
    await waitFor(() => expect(within(tile('Участники')).getByText('12')).toBeTruthy());
    expect(within(tile('В зачёте')).getByText('9')).toBeTruthy();
    expect(within(tile('На проверке')).getByText('3')).toBeTruthy();
    expect(within(tile('Отказы')).getByText('4')).toBeTruthy();
    expect(within(tile('Сбои проверки')).getByText('1')).toBeTruthy();
    expect(within(tile('Исключено')).getByText('3')).toBeTruthy();
  });

  it('чек-лист не пуст: «Опубликовать протокол» неактивна, причина с количеством', async () => {
    await renderApp(PATH);
    const button = await screen.findByRole('button', { name: 'Опубликовать протокол' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(reason.textContent).toBe('Сбои проверки — исключите трек: 1');
    const list = screen.getByRole('list', { name: 'Публикация протокола' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('публикация: причина обязательна → запрос с причиной → обновление гонки и результатов', async () => {
    mocked.getRaceResultsSummary
      .mockResolvedValueOnce(
        summary({ publish: { canPublish: true, blockedBy: null, checklist: CHECKS_EMPTY } }),
      )
      .mockResolvedValue(summary(PUBLISHED));
    mocked.publishProtocol.mockResolvedValue(summary(PUBLISHED));
    await renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Опубликовать протокол' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Опубликовать протокол' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reasonField(), { target: { value: 'Чек-лист пуст' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.publishProtocol).toHaveBeenCalledWith(RACE_ID, { reason: 'Чек-лист пуст' }),
    );
    expect(
      await screen.findByText('Протокол опубликован 27 октября 2026, 12:00, ревизия 2'),
    ).toBeTruthy();
    expect(mocked.getRace.mock.calls.length).toBeGreaterThan(1);
  });

  it('409 RESULTS_PUBLISH_BLOCKED — текст первой причины из details, окно открыто, данные обновлены', async () => {
    mocked.getRaceResultsSummary.mockResolvedValueOnce(
      summary({ publish: { canPublish: true, blockedBy: null, checklist: CHECKS_EMPTY } }),
    );
    mocked.publishProtocol.mockRejectedValue(
      httpError(409, 'RESULTS_PUBLISH_BLOCKED', {
        blockedBy: null,
        checklist: CHECKS_EMPTY.map((check) =>
          check.code === 'unprocessed_tracks' ? { ...check, count: 2 } : check,
        ),
      }),
    );
    await renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Опубликовать протокол' }));
    fireEvent.change(reasonField(), { target: { value: 'Публикуем' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Опубликовать протокол' }),
    );
    expect(await screen.findByText('Необработанные треки участников: 2')).toBeTruthy();
    await waitFor(() => expect(mocked.getRaceResultsSummary).toHaveBeenCalledTimes(2));
  });

  it('попытки: фильтр «Исключена» — запрос со статусом; «Исключить трек» и «Вернуть в обработку»', async () => {
    mocked.excludeAttempt.mockResolvedValue(attempt({ status: 'excluded' }));
    await renderApp(PATH);
    const attempts = await screen.findByRole('region', { name: 'Попытки' });
    expect(await within(attempts).findByText('Проверка не уложилась во время')).toBeTruthy();

    fireEvent.click(within(attempts).getByRole('button', { name: 'Исключить трек' }));
    fireEvent.change(reasonField(), { target: { value: REASON } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Исключить трек' }),
    );
    await waitFor(() =>
      expect(mocked.excludeAttempt).toHaveBeenCalledWith(RACE_ID, ATTEMPT_ID, { reason: REASON }),
    );

    mocked.listRaceAttempts.mockResolvedValue({
      items: [
        attempt({
          status: 'excluded',
          failure: null,
          review: { kind: 'excluded', reason: REASON, at: '2026-10-26T10:00:00.000Z' },
        }),
      ],
      nextCursor: null,
    });
    mocked.restoreAttempt.mockResolvedValue(attempt({ status: 'queued' }));
    fireEvent.click(within(attempts).getByRole('button', { name: 'Исключена' }));
    await waitFor(() =>
      expect(mocked.listRaceAttempts).toHaveBeenLastCalledWith(RACE_ID, {
        limit: 50,
        status: 'excluded',
      }),
    );
    expect(await within(attempts).findByText(`Исключена: ${REASON}`)).toBeTruthy();
    fireEvent.click(within(attempts).getByRole('button', { name: 'Вернуть в обработку' }));
    fireEvent.change(reasonField(), { target: { value: 'Ошибка исключения' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуть в обработку' }),
    );
    await waitFor(() =>
      expect(mocked.restoreAttempt).toHaveBeenCalledWith(RACE_ID, ATTEMPT_ID, {
        reason: 'Ошибка исключения',
      }),
    );
  });

  it('409 RESULTS_ACTION_BLOCKED — текст по details.reason', async () => {
    mocked.excludeAttempt.mockRejectedValue(
      httpError(409, 'RESULTS_ACTION_BLOCKED', { reason: 'protocol_published' }),
    );
    await renderApp(PATH);
    const attempts = await screen.findByRole('region', { name: 'Попытки' });
    fireEvent.click(await within(attempts).findByRole('button', { name: 'Исключить трек' }));
    fireEvent.change(reasonField(), { target: { value: REASON } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Исключить трек' }),
    );
    expect(
      await screen.findByText('Протокол уже опубликован — доступен только экстренный пересчёт.'),
    ).toBeTruthy();
  });

  it('участники: место «=2», короткий id, время, статус; DQ до публикации нет', async () => {
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    const rider = await within(standings).findByText('Участник ·9a0a01');
    const cells = within(rider.closest('tr')!)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual(['=2', 'Участник ·9a0a01', '1:42:03', 'Предварительный', '3']);
    expect(within(standings).queryByRole('button', { name: 'Дисквалифицировать' })).toBeNull();
  });

  it('модератор: действий нет — ни публикации, ни исключения, ни перепроверки', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp(PATH);
    await screen.findByRole('list', { name: 'Публикация протокола' });
    const attempts = section('Попытки');
    await within(attempts).findByText('Проверка не уложилась во время');
    expect(screen.queryByRole('button', { name: 'Опубликовать протокол' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Исключить трек' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перепроверить треки' })).toBeNull();
  });
});

describe('«Результаты» гонки — после публикации', () => {
  beforeEach(() => {
    mocked.getRaceResultsSummary.mockResolvedValue(summary(PUBLISHED));
    mocked.getRaceStandings.mockResolvedValue({
      source: 'protocol',
      revision: 2,
      truncated: false,
      items: [
        row({ resultStatus: 'final', place: 1, tied: false }),
        row({ entryId: ENTRY_B, resultStatus: 'dq', place: null, tied: false }),
      ],
    });
    mocked.listProtocolRecalculations.mockResolvedValue({
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a0f06',
          kind: 'disqualified',
          entryId: ENTRY_B,
          revision: 2,
          reason: 'Чужой трек',
          actor: { userId: USER_ID, displayName: 'Ольга' },
          at: '2026-10-27T10:00:00.000Z',
        },
      ],
    });
  });

  it('баннер ревизии, KPI «в зачёте» из протокола, история пересчётов; исключения треков нет', async () => {
    await renderApp(PATH);
    expect(
      await screen.findByText('Протокол опубликован 27 октября 2026, 12:00, ревизия 2'),
    ).toBeTruthy();
    expect(within(tile('В зачёте')).getByText('8')).toBeTruthy();
    const history = section('История пересчётов');
    expect(await within(history).findByText('Дисквалификация, ревизия 2')).toBeTruthy();
    expect(within(history).getByText('Чужой трек')).toBeTruthy();
    await within(section('Попытки')).findByText('Проверка не уложилась во время');
    expect(screen.queryByRole('button', { name: 'Исключить трек' })).toBeNull();
  });

  it('DQ и отмена DQ — с причиной, тело с entryId', async () => {
    mocked.disqualifyResult.mockResolvedValue(summary(PUBLISHED));
    mocked.revokeDisqualification.mockResolvedValue(summary(PUBLISHED));
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    fireEvent.click(await within(standings).findByRole('button', { name: 'Дисквалифицировать' }));
    fireEvent.change(reasonField(), { target: { value: 'Чужой трек' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Дисквалифицировать' }),
    );
    await waitFor(() =>
      expect(mocked.disqualifyResult).toHaveBeenCalledWith(RACE_ID, {
        entryId: ENTRY_A,
        reason: 'Чужой трек',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(standings).getByRole('button', { name: 'Отменить DQ' }));
    fireEvent.change(reasonField(), { target: { value: 'Спор решён' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Отменить DQ' }),
    );
    await waitFor(() =>
      expect(mocked.revokeDisqualification).toHaveBeenCalledWith(RACE_ID, {
        entryId: ENTRY_B,
        reason: 'Спор решён',
      }),
    );
  });

  it('«Применить пересчёт» неактивна, пока проверки не завершены (причина с количеством)', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(
      summary({
        ...PUBLISHED,
        protocol: { ...PUBLISHED.protocol!, recheckPending: true },
        recheck: { startedAt: '2026-10-27T11:00:00.000Z', pending: 4 },
      }),
    );
    await renderApp(PATH);
    const apply = await screen.findByRole('button', { name: 'Применить пересчёт' });
    expect(apply.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(apply.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Проверки ещё не завершены: 4.',
    );
    fireEvent.click(apply);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('перепроверка и «Применить пересчёт» — запросы с причиной', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(
      summary({
        ...PUBLISHED,
        protocol: { ...PUBLISHED.protocol!, recheckPending: true },
        recheck: { startedAt: '2026-10-27T11:00:00.000Z', pending: 0 },
      }),
    );
    mocked.recheckProtocol.mockResolvedValue(summary(PUBLISHED));
    mocked.applyProtocolRecheck.mockResolvedValue(summary(PUBLISHED));
    await renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Применить пересчёт' }));
    expect(screen.getByText(/Сбои проверки после перепроверки: 1/)).toBeTruthy();
    fireEvent.change(reasonField(), { target: { value: 'Новая версия движка' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Применить пересчёт' }),
    );
    await waitFor(() =>
      expect(mocked.applyProtocolRecheck).toHaveBeenCalledWith(RACE_ID, {
        reason: 'Новая версия движка',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Перепроверить треки' }));
    fireEvent.change(reasonField(), { target: { value: 'Новая версия движка' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Перепроверить треки' }),
    );
    await waitFor(() =>
      expect(mocked.recheckProtocol).toHaveBeenCalledWith(RACE_ID, {
        reason: 'Новая версия движка',
      }),
    );
  });

  it('организатор без results.revise: ни DQ, ни пересчёта', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    await within(standings).findByText('Дисквалифицирован');
    expect(screen.queryByRole('button', { name: 'Дисквалифицировать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить DQ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перепроверить треки' })).toBeNull();
  });
});
