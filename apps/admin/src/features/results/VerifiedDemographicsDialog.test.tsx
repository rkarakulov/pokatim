// @vitest-environment jsdom
import type { PanelRaceResults, PanelStandingRow } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    getRace: vi.fn(),
    getRaceResultsSummary: vi.fn(),
    getRaceStandings: vi.fn(),
    listRaceAttempts: vi.fn(),
    listProtocolRecalculations: vi.fn(),
    getVerifiedDemographics: vi.fn(),
    updateVerifiedDemographics: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const ENTRY = '01890a5d-ac96-774b-bcce-b302099a0a01';
const RIDER = '01890a5d-ac96-774b-bcce-b302099a0d04';
const PATH = `/races/${RACE_ID}/results`;
const REASON = 'Райдер прислал документ с годом';

const SUMMARY = {
  raceId: RACE_ID,
  lockedAt: '2026-10-19T08:00:00.000Z',
  groupScheme: 'gender_age',
  engineVersion: 2,
  counts: {
    entries: 1,
    active: 1,
    withdrawn: 0,
    ranked: 1,
    attempts: {
      queued: 0,
      checking: 0,
      counted: 1,
      rejected: 0,
      failed: 0,
      withdrawn: 0,
      excluded: 0,
    },
    hidden: 0,
    failed: 0,
    staleEngine: 0,
    attention: 0,
    finishers: 0,
  },
  phase: 'closed',
  uploadClosesAt: '2026-10-26T20:59:00.000Z',
  protocol: null,
  recheck: null,
  publish: { canPublish: false, blockedBy: null, checklist: [] },
} satisfies PanelRaceResults;

const ROW: PanelStandingRow = {
  entryId: ENTRY,
  userId: RIDER,
  entryStatus: 'active',
  resultStatus: 'provisional',
  place: 1,
  tied: false,
  elapsedSec: 6123,
  bestAttemptId: null,
  summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
  riderName: null,
  tier: 'verified',
  groupKey: 'm_40_49',
  unranked: null,
  flags: [],
};

const open = async () => {
  await renderApp(PATH);
  const standings = await screen.findByRole('region', { name: 'Участники' });
  fireEvent.click(await within(standings).findByRole('button', { name: 'Пол и год' }));
  return screen.findByRole('dialog');
};
const yearField = (dialog: HTMLElement) =>
  within(dialog).getByLabelText('Год рождения') as HTMLInputElement;
const reasonField = (dialog: HTMLElement) => within(dialog).getByLabelText(/Причина/);
const submit = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Сохранить' });

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.getRace.mockReturnValue(new Promise(() => undefined));
  mocked.getRaceResultsSummary.mockResolvedValue(SUMMARY);
  mocked.getRaceStandings.mockResolvedValue({
    source: 'live',
    revision: null,
    groupScheme: 'gender_age',
    groups: [{ key: 'm_40_49', ranked: 1 }],
    truncated: false,
    items: [ROW],
  });
  mocked.listRaceAttempts.mockResolvedValue({ items: [], nextCursor: null });
  mocked.listProtocolRecalculations.mockResolvedValue({ items: [] });
  mocked.getVerifiedDemographics.mockResolvedValue({
    gender: 'm',
    birthYear: 1981,
    demographicsLocked: true,
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Окно «Пол и год рождения» (race-results-07, profiles.verified_edit)', () => {
  it('загрузка — скелетон полей; затем текущие пол и год, фиксация; веса, роста и FTP нет', async () => {
    let resolve: (value: Awaited<ReturnType<typeof api.getVerifiedDemographics>>) => void = () =>
      undefined;
    mocked.getVerifiedDemographics.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const dialog = await open();
    expect(within(dialog).getAllByTestId('skeleton-field').length).toBeGreaterThan(0);
    expect(submit(dialog).getAttribute('disabled')).not.toBeNull();
    resolve({ gender: 'm', birthYear: 1981, demographicsLocked: true });
    await waitFor(() => expect(yearField(dialog).value).toBe('1981'));
    expect(mocked.getVerifiedDemographics).toHaveBeenCalledWith(RIDER);
    expect(
      (within(dialog).getByRole('radio', { name: 'Мужской' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(within(dialog).getByText(/Зафиксированы заявкой Verified/)).toBeTruthy();
    expect(within(dialog).queryByText(/кг|см|Вт/)).toBeNull();
  });

  it('без изменений «Сохранить» неактивна; правка года и причина → PATCH только с изменённым полем', async () => {
    mocked.updateVerifiedDemographics.mockResolvedValue({
      gender: 'm',
      birthYear: 1979,
      demographicsLocked: true,
      changed: true,
    });
    const dialog = await open();
    await waitFor(() => expect(yearField(dialog).value).toBe('1981'));
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    expect(submit(dialog).getAttribute('disabled')).not.toBeNull();
    expect(within(dialog).getByText('Измените пол или год рождения')).toBeTruthy();
    fireEvent.change(yearField(dialog), { target: { value: '1979' } });
    expect(submit(dialog).getAttribute('disabled')).toBeNull();
    fireEvent.click(submit(dialog));
    await waitFor(() =>
      expect(mocked.updateVerifiedDemographics).toHaveBeenCalledWith(RIDER, {
        birthYear: 1979,
        reason: REASON,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('смена пола — в теле только gender; год вне пределов — ошибка под полем, отправки нет', async () => {
    mocked.updateVerifiedDemographics.mockResolvedValue({
      gender: 'w',
      birthYear: 1981,
      demographicsLocked: true,
      changed: true,
    });
    const dialog = await open();
    await waitFor(() => expect(yearField(dialog).value).toBe('1981'));
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.change(yearField(dialog), { target: { value: '1900' } });
    expect(within(dialog).getByText('Год — от 1920, возраст — не меньше 18 лет')).toBeTruthy();
    expect(submit(dialog).getAttribute('disabled')).not.toBeNull();
    fireEvent.change(yearField(dialog), { target: { value: '1981' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Женский' }));
    fireEvent.click(submit(dialog));
    await waitFor(() =>
      expect(mocked.updateVerifiedDemographics).toHaveBeenCalledWith(RIDER, {
        gender: 'w',
        reason: REASON,
      }),
    );
  });

  it('409 — текст о параллельной правке, окно открыто; 403 — «Нет доступа к этому действию»', async () => {
    mocked.updateVerifiedDemographics
      .mockRejectedValueOnce(httpError(409, 'CONFLICT'))
      .mockRejectedValueOnce(httpError(403, 'FORBIDDEN'));
    const dialog = await open();
    await waitFor(() => expect(yearField(dialog).value).toBe('1981'));
    fireEvent.change(reasonField(dialog), { target: { value: REASON } });
    fireEvent.change(yearField(dialog), { target: { value: '1980' } });
    fireEvent.click(submit(dialog));
    expect(
      await within(dialog).findByText(
        'Анкету изменили одновременно с вами. Закройте окно и повторите.',
      ),
    ).toBeTruthy();
    fireEvent.click(submit(dialog));
    expect(await within(dialog).findByText('Нет доступа к этому действию.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('анкеты нет (404) — «Анкета Verified не заполнена», сохранить нечего', async () => {
    mocked.getVerifiedDemographics.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    const dialog = await open();
    expect(await within(dialog).findByText('Анкета Verified не заполнена')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('нет сети при загрузке — «Нет соединения» с повтором; повтор — поля', async () => {
    mocked.getVerifiedDemographics.mockRejectedValueOnce(networkError());
    const dialog = await open();
    expect(await within(dialog).findByText('Нет соединения')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(yearField(dialog).value).toBe('1981'));
  });
});
