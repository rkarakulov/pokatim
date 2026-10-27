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
    resetRiderName: vi.fn(),
    getVerifiedDemographics: vi.fn(),
    updateVerifiedDemographics: vi.fn(),
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
    attention: 0,
    finishers: 0,
  },
  groupScheme: 'overall',
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
  riderName: null,
  tier: 'verified',
  groupKey: 'overall',
  unranked: null,
  flags: [],
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
  riderName: null,
  sensors: null,
  flags: [],
  flagsVersion: null,
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.getRace.mockResolvedValue(race());
  mocked.getRaceResultsSummary.mockResolvedValue(summary());
  mocked.getRaceStandings.mockResolvedValue({
    source: 'live',
    revision: null,
    groupScheme: 'overall',
    groups: [],
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
    expect(screen.getAllByTestId('skeleton-stat')).toHaveLength(8);
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
    expect(reason.textContent).toBe('Сбои проверки — исключите трек: 1.');
    const list = screen.getByRole('list', { name: 'Публикация протокола' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('чек-лист (B14): под кнопкой все блокеры; булево условие без счётчика; нулевые строки — без призыва', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(
      summary({
        publish: {
          canPublish: false,
          blockedBy: null,
          checklist: CHECKS_EMPTY.map((check) =>
            check.code === 'open_disputes'
              ? { ...check, count: 4 }
              : check.code === 'window_open'
                ? { ...check, count: 1 }
                : check,
          ),
        },
      }),
    );
    await renderApp(PATH);
    const button = await screen.findByRole('button', { name: 'Опубликовать протокол' });
    const reason = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(reason.textContent).toBe('Открытые споры: 4. Срок загрузки заездов ещё не истёк.');

    const items = within(screen.getByRole('list', { name: 'Публикация протокола' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      '4Открытые споры: 4Открыть споры',
      '✓ ГотовоНеобработанных треков участников нет',
      '✓ ГотовоНезавершённых проверок нет',
      '✓ ГотовоСбоев проверки нет',
      'Не готовоСрок загрузки заездов ещё не истёк',
    ]);
  });

  it('публикация: причина обязательна → запрос с причиной → обновление гонки и результатов', async () => {
    mocked.getRaceResultsSummary
      .mockResolvedValueOnce(
        summary({ publish: { canPublish: true, blockedBy: null, checklist: CHECKS_EMPTY } }),
      )
      .mockResolvedValue(summary(PUBLISHED));
    mocked.publishProtocol.mockResolvedValue(summary(PUBLISHED));
    const { queryClient } = await renderApp(PATH);
    // список гонок (фаза) и журнал, открытые раньше, после действия устарели (staleTime панели — B12)
    queryClient.setQueryData(['admin', 'races', 'list', 'probe'], 'список');
    queryClient.setQueryData(['admin', 'audit', 'probe'], 'журнал');
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
    for (const key of [
      ['admin', 'races', 'list', 'probe'],
      ['admin', 'audit', 'probe'],
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
    }
  });

  it('409 RESULTS_PUBLISH_BLOCKED — причины из details, окно открыто, данные обновлены', async () => {
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
    expect(await screen.findByText('Необработанные треки участников: 2.')).toBeTruthy();
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
    // колонка действий до публикации — права сброса имени (profile-02) и пола/года (07); группа overall — без «Пол и год»
    expect(cells).toEqual([
      '=2',
      'Участник ·9a0a01',
      'Общий зачёт',
      'Verified',
      '1:42:03',
      'Предварительный',
      '—',
      '3',
      '',
    ]);
    expect(within(standings).queryByRole('button', { name: 'Дисквалифицировать' })).toBeNull();
    expect(within(standings).queryByRole('button', { name: 'Сбросить имя' })).toBeNull();
  });

  it('время меньше часа — «0:32:19», как в приложении (B15); источник auto — «Автоматически» (B16)', async () => {
    mocked.getRaceStandings.mockResolvedValue({
      source: 'live',
      revision: null,
      groupScheme: 'overall',
      groups: [],
      truncated: false,
      items: [row({ elapsedSec: 1939 })],
    });
    mocked.listRaceAttempts.mockResolvedValue({
      items: [attempt({ origin: 'auto' })],
      nextCursor: null,
    });
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    expect(await within(standings).findByText('0:32:19')).toBeTruthy();
    const attempts = section('Попытки');
    expect(await within(attempts).findByText('Автоматически')).toBeTruthy();
  });

  it('открытые споры (06): ссылка «Открыть споры» на список гонки — при count > 0 и disputes.read', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(
      summary({
        publish: {
          canPublish: false,
          blockedBy: null,
          checklist: CHECKS_EMPTY.map((check) =>
            check.code === 'open_disputes' ? { ...check, count: 2 } : check,
          ),
        },
      }),
    );
    await renderApp(PATH);
    const list = await screen.findByRole('list', { name: 'Публикация протокола' });
    expect(within(list).getByText('Открытые споры: 2')).toBeTruthy();
    const link = within(list).getByRole('link', { name: 'Открыть споры' });
    expect(link.getAttribute('href')).toBe(`/admin/disputes?raceId=${RACE_ID}`);
    cleanup();
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp(PATH);
    const again = await screen.findByRole('list', { name: 'Публикация протокола' });
    expect(within(again).queryByRole('link', { name: 'Открыть споры' })).toBeNull();
  });

  it('без открытых споров ссылки нет', async () => {
    await renderApp(PATH);
    const list = await screen.findByRole('list', { name: 'Публикация протокола' });
    expect(within(list).queryByRole('link', { name: 'Открыть споры' })).toBeNull();
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

  it('черновик (открыт по URL): ни исключения, ни перепроверки — сервер ответил бы 404', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(
      summary({
        phase: 'draft',
        publish: { canPublish: false, blockedBy: 'draft', checklist: CHECKS_EMPTY },
      }),
    );
    await renderApp(PATH);
    const attempts = await screen.findByRole('region', { name: 'Попытки' });
    await within(attempts).findByText('Проверка не уложилась во время');
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
      groupScheme: 'overall',
      groups: [],
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

  it('история пересчётов: DQ по решению спора — «Решение по спору ·xxxxxx» со ссылкой на разбор (RC-13)', async () => {
    const DISPUTE_ID = '01890a5d-ac96-774b-bcce-b302099a9001';
    mocked.listProtocolRecalculations.mockResolvedValue({
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a0f07',
          kind: 'disqualified',
          entryId: ENTRY_B,
          revision: null,
          reason: `dispute:${DISPUTE_ID}`,
          actor: { userId: USER_ID, displayName: 'Марк' },
          at: '2026-10-26T20:00:00.000Z',
        },
      ],
    });
    await renderApp(PATH);
    const history = await screen.findByRole('region', { name: 'История пересчётов' });
    const link = await within(history).findByRole('link', { name: 'Решение по спору ·9a9001' });
    expect(link.getAttribute('href')).toBe(`/admin/disputes/${DISPUTE_ID}`);

    // без `disputes.read` (организатор) — текст без ссылки
    cleanup();
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp(PATH);
    const plain = await screen.findByRole('region', { name: 'История пересчётов' });
    expect(await within(plain).findByText('Решение по спору ·9a9001')).toBeTruthy();
    expect(within(plain).queryByRole('link', { name: 'Решение по спору ·9a9001' })).toBeNull();
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

describe('«Результаты» гонки — имя участника (profile-02)', () => {
  const NAMED = row({ riderName: 'Анна К.' });

  it('имя при согласии — «Анна К. ·id» в участниках и попытках, иначе «Участник ·id» (AC5)', async () => {
    mocked.getRaceStandings.mockResolvedValue({
      source: 'live',
      revision: null,
      groupScheme: 'overall',
      groups: [],
      truncated: false,
      items: [NAMED, row({ entryId: ENTRY_B, place: 3, tied: false })],
    });
    mocked.listRaceAttempts.mockResolvedValue({
      items: [attempt({ riderName: 'Анна К.' })],
      nextCursor: null,
    });
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    expect(await within(standings).findByText('Анна К. ·9a0a01')).toBeTruthy();
    expect(within(standings).getByText('Участник ·9a0b02')).toBeTruthy();
    const attempts = section('Попытки');
    expect(await within(attempts).findByText('Анна К. ·9a0a01')).toBeTruthy();
  });

  it('организатор без profiles.moderate: до публикации колонки действий нет, «Сбросить имя» нет', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    mocked.getRaceStandings.mockResolvedValue({
      source: 'live',
      revision: null,
      groupScheme: 'overall',
      groups: [],
      truncated: false,
      items: [NAMED],
    });
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    const rider = await within(standings).findByText('Анна К. ·9a0a01');
    // место, участник, группа, уровень, время, статус, «Требует внимания», попытки — без действий
    expect(within(rider.closest('tr')!).getAllByRole('cell')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'Сбросить имя' })).toBeNull();
  });

  it('модератор: «Сбросить имя» → ReasonDialog с предупреждением → запрос → строка «Участник» (AC7)', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    mocked.getRaceStandings
      .mockResolvedValueOnce({
        source: 'live',
        revision: null,
        groupScheme: 'overall',
        groups: [],
        truncated: false,
        items: [NAMED],
      })
      .mockResolvedValue({
        source: 'live',
        revision: null,
        groupScheme: 'overall',
        groups: [],
        truncated: false,
        items: [row()],
      });
    mocked.resetRiderName.mockResolvedValue({ reset: true });
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    fireEvent.click(await within(standings).findByRole('button', { name: 'Сбросить имя' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Не повторяйте имя в причине/)).toBeTruthy();
    fireEvent.change(reasonField(), { target: { value: 'Оскорбительное имя' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сбросить имя' }));
    await waitFor(() =>
      expect(mocked.resetRiderName).toHaveBeenCalledWith(USER_A, { reason: 'Оскорбительное имя' }),
    );
    expect(await within(standings).findByText('Участник ·9a0a01')).toBeTruthy();
    expect(within(standings).queryByRole('button', { name: 'Сбросить имя' })).toBeNull();
  });

  it('после публикации у админа — и DQ, и «Сбросить имя» в одной ячейке', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(summary(PUBLISHED));
    mocked.getRaceStandings.mockResolvedValue({
      source: 'protocol',
      revision: 2,
      groupScheme: 'overall',
      groups: [],
      truncated: false,
      items: [row({ riderName: 'Анна К.', resultStatus: 'final', place: 1, tied: false })],
    });
    await renderApp(PATH);
    const standings = await screen.findByRole('region', { name: 'Участники' });
    expect(
      await within(standings).findByRole('button', { name: 'Дисквалифицировать' }),
    ).toBeTruthy();
    expect(within(standings).getByRole('button', { name: 'Сбросить имя' })).toBeTruthy();
  });
});

describe('«Результаты» гонки — группы, уровни, «Требует внимания» (race-results-07)', () => {
  const ENTRY_C = '01890a5d-ac96-774b-bcce-b302099a0c0c';
  const USER_C = '01890a5d-ac96-774b-bcce-b302099a0d0c';
  const standings = (items: PanelStandingRow[], groups = GROUPS) => ({
    source: 'live' as const,
    revision: null,
    groupScheme: 'gender_age' as const,
    groups,
    truncated: false,
    items,
  });
  const GROUPS: { key: 'm_u40' | 'w_u40'; ranked: number }[] = [
    { key: 'm_u40', ranked: 3 },
    { key: 'w_u40', ranked: 1 },
  ];
  const FLAGGED = row({
    place: 1,
    tied: false,
    groupKey: 'm_u40',
    flags: [
      { code: 'SPEED_CLUSTER_HIGH', metric: 0.782 },
      { code: 'HR_GAPS', metric: 18 },
    ],
  });
  const FINISHER = row({
    entryId: ENTRY_C,
    userId: USER_C,
    resultStatus: 'finisher',
    place: null,
    tied: false,
    elapsedSec: 7000,
    tier: 'start',
    groupKey: 'overall',
    unranked: 'start',
    flags: [{ code: 'HR_POWER_DECOUPLED', metric: 40 }],
  });

  beforeEach(() => {
    mocked.getRaceResultsSummary.mockResolvedValue(
      summary({
        groupScheme: 'gender_age',
        counts: { ...summary().counts, attention: 2, finishers: 1 },
      }),
    );
    mocked.getRaceStandings.mockResolvedValue(standings([FLAGGED, FINISHER]));
  });

  it('KPI «Требует внимания» и «Финишёры» — из counts сервера', async () => {
    await renderApp(PATH);
    await waitFor(() => expect(within(tile('Требует внимания')).getByText('2')).toBeTruthy());
    expect(within(tile('Финишёры')).getByText('1')).toBeTruthy();
  });

  it('строка с местом: группа, уровень, флаги с метрикой подсказкой; финишёр — отдельным блоком без места', async () => {
    await renderApp(PATH);
    const ranked = await screen.findByRole('region', { name: 'Участники' });
    const leader = (await within(ranked).findByText('Участник ·9a0a01')).closest('tr')!;
    expect(within(leader).getByText('Мужчины до 40')).toBeTruthy();
    expect(within(leader).getByText('Verified')).toBeTruthy();
    expect(within(leader).getByText('Скорость выше группы')).toBeTruthy();
    expect(within(leader).getByText('Время ×0,782 медианы группы')).toBeTruthy();
    expect(within(leader).getByText('Пропуски пульса')).toBeTruthy();
    expect(within(leader).getByText('18 % сегмента без пульса')).toBeTruthy();
    expect(within(ranked).queryByText('Участник ·9a0c0c')).toBeNull();

    const finishers = section('Финишёры — без места');
    const finisher = within(finishers).getByText('Участник ·9a0c0c').closest('tr')!;
    expect(within(finisher).getByText('START')).toBeTruthy();
    expect(within(finisher).getByText('Финишёр')).toBeTruthy();
    expect(within(finisher).getByText('1:56:40')).toBeTruthy();
    expect(within(finisher).getByText('Пульс не отвечает на мощность')).toBeTruthy();
    // метрика HR_POWER_DECOUPLED — расхождение половин или доля рывков: подпись нейтральная
    expect(within(finisher).getByText('Расхождение 40 %')).toBeTruthy();
    expect(within(finishers).queryByRole('columnheader', { name: 'Место' })).toBeNull();
  });

  it('финишёры — отдельный запрос finishers=true: за пределом «Участников» не теряются, свой баннер предела', async () => {
    mocked.getRaceStandings.mockImplementation((_raceId, params = {}) =>
      Promise.resolve(
        params.finishers
          ? { ...standings([FINISHER]), truncated: true }
          : { ...standings([FLAGGED]), truncated: true },
      ),
    );
    await renderApp(PATH);
    const finishers = await screen.findByRole('region', { name: 'Финишёры — без места' });
    expect(await within(finishers).findByText('Участник ·9a0c0c')).toBeTruthy();
    expect(within(finishers).getByText('Показаны первые 1 финишёров')).toBeTruthy();
    expect(mocked.getRaceStandings).toHaveBeenCalledWith(RACE_ID, { finishers: 'true' });
    expect(mocked.getRaceStandings).toHaveBeenCalledWith(RACE_ID, {});
    const ranked = screen.getByRole('region', { name: 'Участники' });
    expect(within(ranked).getByText('Показаны первые 1 участников')).toBeTruthy();
  });

  it('вкладки групп и фильтр «Требует внимания» — запросы с group и attention, сброс — «Все группы»', async () => {
    await renderApp(PATH);
    const ranked = await screen.findByRole('region', { name: 'Участники' });
    await within(ranked).findByText('Участник ·9a0a01');
    // «Участники» и «Финишёры» — с одними фильтрами; финишёры — с `finishers`
    const called = (params: object) => {
      expect(mocked.getRaceStandings).toHaveBeenCalledWith(RACE_ID, params);
      expect(mocked.getRaceStandings).toHaveBeenCalledWith(RACE_ID, {
        ...params,
        finishers: 'true',
      });
    };
    await waitFor(() => called({}));
    fireEvent.click(within(ranked).getByRole('button', { name: 'Мужчины до 40 · 3' }));
    await waitFor(() => called({ group: 'm_u40' }));
    fireEvent.click(within(ranked).getByRole('button', { name: 'Только «Требует внимания»' }));
    await waitFor(() => called({ group: 'm_u40', attention: 'true' }));
    fireEvent.click(within(ranked).getByRole('button', { name: 'Все группы' }));
    await waitFor(() => called({ attention: 'true' }));
    expect(
      within(ranked).getByRole('button', { name: 'Все группы' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('фильтр без строк — «Нет участников по выбранным фильтрам», фильтры остаются', async () => {
    await renderApp(PATH);
    const ranked = await screen.findByRole('region', { name: 'Участники' });
    await within(ranked).findByText('Участник ·9a0a01');
    mocked.getRaceStandings.mockResolvedValue(standings([]));
    fireEvent.click(within(ranked).getByRole('button', { name: 'Женщины до 40 · 1' }));
    expect(await within(ranked).findByText('Нет участников по выбранным фильтрам')).toBeTruthy();
    expect(within(ranked).getByRole('button', { name: 'Все группы' })).toBeTruthy();
    expect(
      within(section('Финишёры — без места')).getByText('Нет финишёров по выбранным фильтрам'),
    ).toBeTruthy();
  });

  it('ошибка таблицы при смене фильтра — «Не удалось загрузить» с повтором, фильтры видны', async () => {
    await renderApp(PATH);
    const ranked = await screen.findByRole('region', { name: 'Участники' });
    await within(ranked).findByText('Участник ·9a0a01');
    mocked.getRaceStandings.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    fireEvent.click(within(ranked).getByRole('button', { name: 'Только «Требует внимания»' }));
    expect(await within(ranked).findByText('Не удалось загрузить')).toBeTruthy();
    expect(within(ranked).getByRole('button', { name: 'Мужчины до 40 · 3' })).toBeTruthy();
    fireEvent.click(within(ranked).getByRole('button', { name: 'Повторить' }));
    expect(await within(ranked).findByText('Участник ·9a0a01')).toBeTruthy();
  });

  it('гонка без групп (схема overall) — вкладок нет, блока финишёров нет', async () => {
    mocked.getRaceResultsSummary.mockResolvedValue(summary());
    mocked.getRaceStandings.mockResolvedValue({
      ...standings([row()], []),
      groupScheme: 'overall',
    });
    await renderApp(PATH);
    const ranked = await screen.findByRole('region', { name: 'Участники' });
    await within(ranked).findByText('Участник ·9a0a01');
    expect(within(ranked).queryByRole('button', { name: 'Все группы' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Финишёры — без места' })).toBeNull();
  });

  it('попытки: датчики и флаги датчиков с метрикой', async () => {
    mocked.listRaceAttempts.mockResolvedValue({
      items: [
        attempt({
          status: 'counted',
          failure: null,
          sensors: { hr: true, power: true, source: 'samples' },
          flags: [{ code: 'HR_GAPS', metric: 18 }],
          flagsVersion: 1,
        }),
        attempt({
          id: '01890a5d-ac96-774b-bcce-b302099a0c99',
          sensors: { hr: false, power: false, source: 'samples' },
        }),
        attempt({
          id: '01890a5d-ac96-774b-bcce-b302099a0c9a',
          status: 'counted',
          failure: null,
          sensors: { hr: true, power: false, source: 'declared' },
          flags: [],
          flagsVersion: 1,
        }),
      ],
      nextCursor: null,
    });
    await renderApp(PATH);
    const attempts = await screen.findByRole('region', { name: 'Попытки' });
    expect(await within(attempts).findByText('Пульс, мощность')).toBeTruthy();
    expect(within(attempts).getByText('Нет')).toBeTruthy();
    // DV-11: импорт Garmin/Wahoo — датчики заявлены потоком, флаги не считаются
    expect(within(attempts).getByText('Пульс (заявлено импортом)')).toBeTruthy();
    expect(within(attempts).getByText('Пропуски пульса')).toBeTruthy();
    expect(within(attempts).getByText('18 % сегмента без пульса')).toBeTruthy();
  });

  it('«Пол и год» — только с profiles.verified_edit и только у Verified в группе пол × возраст', async () => {
    await renderApp(PATH);
    const ranked = await screen.findByRole('region', { name: 'Участники' });
    const leader = (await within(ranked).findByText('Участник ·9a0a01')).closest('tr')!;
    expect(within(leader).getByRole('button', { name: 'Пол и год' })).toBeTruthy();
    expect(
      within(section('Финишёры — без места')).queryByRole('button', { name: 'Пол и год' }),
    ).toBeNull();
    cleanup();
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp(PATH);
    const asModerator = await screen.findByRole('region', { name: 'Участники' });
    await within(asModerator).findByText('Участник ·9a0a01');
    expect(screen.queryByRole('button', { name: 'Пол и год' })).toBeNull();
  });
});
