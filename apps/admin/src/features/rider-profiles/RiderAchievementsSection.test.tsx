// @vitest-environment jsdom
import type {
  RiderAchievementAdminItem,
  RiderAchievementsAdmin,
  RiderProfileModerationDetail,
} from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp, unauthorized, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    getRiderProfile: vi.fn(),
    riderAvatarUrl: vi.fn(),
    getRiderAchievements: vi.fn(),
    grantRiderAchievement: vi.fn(),
    revokeRiderAchievement: vi.fn(),
    clearRiderAchievementOverride: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const RACE = '01890a5d-ac96-774b-bcce-b302099a8101';
const ROUTE = '01890a5d-ac96-774b-bcce-b302099a8102';
const SEASON = '01890a5d-ac96-774b-bcce-b302099a8103';
const NEW_RACE = '01890a5d-ac96-774b-bcce-b302099a8104';
const WARNING = 'Причина видна команде: она навсегда остаётся в журнале действий.';

const ADMIN = {
  ...ME.admin,
  permissions: [...ME.admin.permissions, 'achievements.manage' as const],
};

const profile: RiderProfileModerationDetail = {
  userId: ID,
  name: 'Анна К.',
  club: null,
  avatar: null,
  isPublic: true,
  openReportCount: 0,
  lastReportAt: null,
  reportRevision: 0,
  avatarUploadBlockedUntil: null,
  avatarResetCount: 0,
  reports: [],
};

const item = (overrides: Partial<RiderAchievementAdminItem>): RiderAchievementAdminItem => ({
  code: 'race_podium',
  object: { kind: 'race', id: RACE, title: 'Минская сотка' },
  level: null,
  factDate: '2026-09-14',
  status: 'granted',
  grantedAt: '2026-09-14T10:00:00.000Z',
  revokedAt: null,
  override: null,
  byFacts: { state: 'earned', level: null },
  ...overrides,
});

const ITEMS: RiderAchievementAdminItem[] = [
  item({}),
  item({
    code: 'races_5',
    level: 'bronze',
    status: 'granted_manually',
    override: {
      decision: 'granted',
      at: '2026-10-30T09:00:00.000Z',
      by: { userId: USER_ID, displayName: 'Ольга' },
    },
    byFacts: { state: 'earned', level: 'silver' },
  }),
  item({
    code: 'route_first',
    object: { kind: 'route', id: ROUTE, title: null },
    factDate: '2026-08-01',
    status: 'revoked_manually',
    revokedAt: '2026-10-29T08:00:00.000Z',
    override: {
      decision: 'revoked',
      at: '2026-10-29T08:00:00.000Z',
      by: { userId: USER_ID, displayName: 'Ольга' },
    },
    byFacts: { state: 'not_earned', level: null },
  }),
  item({
    code: 'season_champion',
    object: { kind: 'season', id: SEASON, title: 'Сезон 2026' },
    factDate: '2026-07-31',
    status: 'revoked',
    revokedAt: '2026-10-01T08:00:00.000Z',
    byFacts: { state: 'unknown', level: null },
  }),
];

const list = (overrides: Partial<RiderAchievementsAdmin> = {}): RiderAchievementsAdmin => ({
  items: ITEMS,
  seasonsAvailable: true,
  ...overrides,
});

const open = () => renderApp(`/rider-profiles/${ID}`);
const section = async () =>
  (await screen.findByRole('heading', { name: 'Достижения' })).closest('section') as HTMLElement;
const dialog = () => screen.getByRole('dialog');
const loaded = (block: HTMLElement) =>
  within(block).findAllByText('Гонка · Минская сотка', { exact: false });
const table = () => screen.getByRole('table', { name: 'Достижения' });
const rowsText = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 6)
        .map((cell) => cell.textContent),
    );
const fillReason = (value = 'технический сбой') =>
  fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value } });

beforeEach(() => {
  mocked.me.mockResolvedValue(ADMIN);
  mocked.getRiderProfile.mockResolvedValue(profile);
  mocked.getRiderAchievements.mockResolvedValue(list());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('блок «Достижения» карточки райдера (achievements-panel, AC5)', () => {
  it('moderator без `achievements.manage` — блока нет и запроса нет', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await open();
    expect(await screen.findByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Достижения' })).toBeNull();
    expect(mocked.getRiderAchievements).not.toHaveBeenCalled();
  });

  it('таблица: достижение и уровень, объект, дата факта, статус, решение, «По фактам»; действия строк', async () => {
    await open();
    const block = await section();
    await loaded(block);
    expect(mocked.getRiderAchievements).toHaveBeenCalledWith(ID);
    expect(within(block).getByRole('button', { name: 'Выдать вручную' })).toBeTruthy();
    expect(rowsText()).toEqual([
      ['Подиум', 'Гонка · Минская сотка', '14 сентября 2026', 'Выдано', '—', 'Заработано'],
      [
        'Гонщик · Бронза',
        'Гонка · Минская сотка',
        '14 сентября 2026',
        'Выдано вручную',
        'Ольга · 30.10.2026, 12:00',
        'Заработано · Серебро',
      ],
      [
        'Первый маршрут',
        'Объект недоступен ·9a8102',
        '1 августа 2026',
        'Отозвано вручную',
        'Ольга · 29.10.2026, 11:00',
        'Не заработано',
      ],
      [
        'Чемпион сезона',
        'Сезон · Сезон 2026',
        '31 июля 2026',
        'Отозвано сверкой',
        '—',
        'Неизвестно',
      ],
    ]);
    // «Отозвать» — у видимых, «Вернуть автоматике» — у ручных решений; подпись включает название достижения
    expect(
      within(block)
        .getAllByRole('button', { name: /^Отозвать:/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Отозвать: Подиум, Гонка · Минская сотка',
      'Отозвать: Гонщик · Бронза, Гонка · Минская сотка',
    ]);
    expect(
      within(block)
        .getAllByRole('button', { name: /^Вернуть автоматике:/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Вернуть автоматике: Гонщик · Бронза, Гонка · Минская сотка',
      'Вернуть автоматике: Первый маршрут, Объект недоступен ·9a8102',
    ]);
  });

  it('первая загрузка — скелетон строк под видимым заголовком и кнопкой', async () => {
    mocked.getRiderAchievements.mockReturnValue(new Promise(() => undefined));
    await open();
    const block = await section();
    expect(within(block).getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
    // без списка окно не знает выданных кодов — кнопка видна, но неактивна
    const grant = within(block).getByRole('button', { name: 'Выдать вручную' });
    expect(grant.hasAttribute('disabled')).toBe(true);
  });

  it('ошибка без данных — «Нет соединения» с повтором; повтор перечитывает блок', async () => {
    mocked.getRiderAchievements.mockRejectedValueOnce(networkError());
    await open();
    const block = await section();
    expect(await within(block).findByText('Нет соединения')).toBeTruthy();
    const grant = within(block).getByRole('button', { name: 'Выдать вручную' });
    expect(grant.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(block).getByRole('button', { name: 'Повторить' }));
    await loaded(block);
    expect(grant.hasAttribute('disabled')).toBe(false);
    expect(mocked.getRiderAchievements).toHaveBeenCalledTimes(2);
  });

  it('пусто — «Достижений нет»; сезоны недоступны — предупреждение', async () => {
    mocked.getRiderAchievements.mockResolvedValue(list({ items: [], seasonsAvailable: false }));
    await open();
    const block = await section();
    expect(await within(block).findByText('Достижений нет')).toBeTruthy();
    expect(within(block).getByText('Сезонные достижения временно недоступны')).toBeTruthy();
  });

  it('403 блока — блок скрыт, карточка остаётся', async () => {
    mocked.getRiderAchievements.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await open();
    expect(await screen.findByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Достижения' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
  });

  it('«Выдать вручную»: подпись поля по виду, уровень только у счётного (бронза), подтверждение — UUID и причина; журнал перечитан', async () => {
    mocked.grantRiderAchievement.mockResolvedValue(undefined);
    const { queryClient } = await open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const block = await section();
    await loaded(block);
    fireEvent.click(within(block).getByRole('button', { name: 'Выдать вручную' }));

    expect(within(dialog()).getByText(WARNING)).toBeTruthy();
    expect(
      within(dialog()).getByText(
        'Райдер увидит достижение и получит уведомление. Автоматика не отзовёт его, пока решение не снимут.',
      ),
    ).toBeTruthy();
    const code = within(dialog()).getByLabelText('Достижение') as HTMLSelectElement;
    // видимая несезонная выдача — вариант неактивен с текстовой причиной
    const podium = within(code).getByRole('option', { name: 'Подиум — уже выдано' });
    expect((podium as HTMLOptionElement).disabled).toBe(true);
    expect(code.value).toBe('race_first_finish');
    expect(within(dialog()).getByLabelText('ID гонки')).toBeTruthy();
    expect(within(dialog()).queryByLabelText('Уровень')).toBeNull();

    fireEvent.change(code, { target: { value: 'season_regular' } });
    expect(within(dialog()).getByLabelText('ID сезона')).toBeTruthy();

    fireEvent.change(code, { target: { value: 'rides_10' } });
    expect(within(dialog()).getByLabelText('ID кофе-райда')).toBeTruthy();
    const level = within(dialog()).getByLabelText('Уровень') as HTMLSelectElement;
    expect(level.value).toBe('bronze');
    fireEvent.change(level, { target: { value: 'gold' } });

    const confirm = within(dialog()).getByRole('button', { name: 'Выдать' });
    fillReason();
    expect(confirm.hasAttribute('disabled')).toBe(true);
    const rideField = within(dialog()).getByLabelText('ID кофе-райда');
    expect(rideField.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(rideField, { target: { value: 'не uuid' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    // непустой не-UUID — объяснение под полем, а не молча неактивная кнопка
    expect(rideField.getAttribute('aria-invalid')).toBe('true');
    const formatId = rideField.getAttribute('aria-describedby')?.split(' ')[0] ?? '';
    expect(document.getElementById(formatId)?.textContent).toBe(
      'Это не id — скопируйте его из адреса страницы',
    );
    fireEvent.change(within(dialog()).getByLabelText('ID кофе-райда'), {
      target: { value: ` ${NEW_RACE} ` },
    });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(rideField.getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocked.grantRiderAchievement).toHaveBeenCalledWith(ID, {
        code: 'rides_10',
        objectId: NEW_RACE,
        level: 'gold',
        reason: 'технический сбой',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'audit'] });
    await waitFor(() => expect(mocked.getRiderAchievements).toHaveBeenCalledTimes(2));
  });

  it('разовый код — без уровня в теле', async () => {
    mocked.grantRiderAchievement.mockResolvedValue(undefined);
    await open();
    const block = await section();
    await loaded(block);
    fireEvent.click(within(block).getByRole('button', { name: 'Выдать вручную' }));
    fireEvent.change(within(dialog()).getByLabelText('ID гонки'), { target: { value: NEW_RACE } });
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Выдать' }));
    await waitFor(() =>
      expect(mocked.grantRiderAchievement).toHaveBeenCalledWith(ID, {
        code: 'race_first_finish',
        objectId: NEW_RACE,
        reason: 'технический сбой',
      }),
    );
  });

  it.each([
    [
      httpError(409, 'ACHIEVEMENT_INVALID_STATE', { reason: 'already_granted' }),
      'У райдера уже есть это достижение — список обновлён.',
    ],
    [httpError(404, 'NOT_FOUND'), 'Райдер не найден'],
    [httpError(429, 'RATE_LIMITED'), 'Слишком много действий — попробуйте позже'],
    [
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'level', code: 'INVALID' }] }),
      'Проверьте поля',
    ],
  ])('ошибка выдачи — текст в окне (%#)', async (error, text) => {
    mocked.grantRiderAchievement.mockRejectedValue(error);
    await open();
    const block = await section();
    await loaded(block);
    fireEvent.click(within(block).getByRole('button', { name: 'Выдать вручную' }));
    fireEvent.change(within(dialog()).getByLabelText('ID гонки'), { target: { value: NEW_RACE } });
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Выдать' }));
    expect(await within(dialog()).findByText(text)).toBeTruthy();
    if (text.startsWith('У райдера')) {
      await waitFor(() => expect(mocked.getRiderAchievements).toHaveBeenCalledTimes(2));
    }
  });

  it('409 `already_granted` — выбранный код не подменяется, «Выдать» неактивна до явного выбора другого', async () => {
    mocked.grantRiderAchievement.mockRejectedValue(
      httpError(409, 'ACHIEVEMENT_INVALID_STATE', { reason: 'already_granted' }),
    );
    await open();
    const block = await section();
    await loaded(block);
    fireEvent.click(within(block).getByRole('button', { name: 'Выдать вручную' }));
    const code = within(dialog()).getByLabelText('Достижение') as HTMLSelectElement;
    expect(code.value).toBe('race_first_finish');
    // другой сотрудник успел выдать «Первый финиш» — перечитанный список содержит выбранный код
    mocked.getRiderAchievements.mockResolvedValue(
      list({ items: [...ITEMS, item({ code: 'race_first_finish' })] }),
    );
    fireEvent.change(within(dialog()).getByLabelText('ID гонки'), { target: { value: NEW_RACE } });
    fillReason();
    const confirm = within(dialog()).getByRole('button', { name: 'Выдать' });
    fireEvent.click(confirm);
    expect(
      await within(dialog()).findByText('У райдера уже есть это достижение — список обновлён.'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        (within(code).getByRole('option', { name: /^Первый финиш/ }) as HTMLOptionElement).disabled,
      ).toBe(true),
    );
    expect(code.value).toBe('race_first_finish');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(code.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(code, { target: { value: 'race_win' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(mocked.grantRiderAchievement).toHaveBeenCalledTimes(1);
  });

  it('401 на выдаче — общий выход на «Вход» с «Сессия истекла»', async () => {
    mocked.grantRiderAchievement.mockRejectedValue(unauthorized());
    const { router } = await open();
    const block = await section();
    await loaded(block);
    fireEvent.click(within(block).getByRole('button', { name: 'Выдать вручную' }));
    fireEvent.change(within(dialog()).getByLabelText('ID гонки'), { target: { value: NEW_RACE } });
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Выдать' }));
    expect(await screen.findByText('Сессия истекла')).toBeTruthy();
    expect(router.state.location.search).toEqual({
      reason: 'expired',
      next: `/rider-profiles/${ID}`,
    });
  });

  it('403 на отзыве — права перечитаны; без `achievements.manage` блок пропадает', async () => {
    mocked.revokeRiderAchievement.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await open();
    const block = await section();
    const revoke = await within(block).findByRole('button', {
      name: 'Отозвать: Подиум, Гонка · Минская сотка',
    });
    const meCalls = mocked.me.mock.calls.length;
    mocked.me.mockResolvedValue(ME.moderator);
    fireEvent.click(revoke);
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Отозвать' }));
    await waitFor(() => expect(mocked.me.mock.calls.length).toBeGreaterThan(meCalls));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Достижения' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
  });

  it('после «Отозвать» исчезнувшая кнопка строки — фокус на заголовке блока, не на body', async () => {
    mocked.revokeRiderAchievement.mockResolvedValue(undefined);
    await open();
    const block = await section();
    const revoke = await within(block).findByRole('button', {
      name: 'Отозвать: Подиум, Гонка · Минская сотка',
    });
    mocked.getRiderAchievements.mockResolvedValue(
      list({
        items: [
          item({
            status: 'revoked_manually',
            revokedAt: '2026-10-31T08:00:00.000Z',
            override: {
              decision: 'revoked',
              at: '2026-10-31T08:00:00.000Z',
              by: { userId: USER_ID, displayName: 'Ольга' },
            },
          }),
        ],
      }),
    );
    revoke.focus();
    fireEvent.click(revoke);
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Отозвать' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(revoke.isConnected).toBe(false);
    expect(document.activeElement).toBe(within(block).getByRole('heading', { name: 'Достижения' }));
  });

  it('400 `objectId` — ошибка под полем id объекта', async () => {
    mocked.grantRiderAchievement.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'objectId', code: 'INVALID' }] }),
    );
    await open();
    const block = await section();
    await loaded(block);
    fireEvent.click(within(block).getByRole('button', { name: 'Выдать вручную' }));
    const field = within(dialog()).getByLabelText('ID гонки');
    fireEvent.change(field, { target: { value: NEW_RACE } });
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Выдать' }));
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    const errorId = field.getAttribute('aria-describedby')?.split(' ')[0] ?? '';
    expect(document.getElementById(errorId)?.textContent).toBe(
      'Объект не найден или не подходит этому достижению',
    );
  });

  it('«Отозвать» — деструктивное окно с предупреждением; сезонный — с `seasonId`; ошибка обновления — баннер', async () => {
    mocked.getRiderAchievements.mockResolvedValue(
      list({
        items: [
          item({
            code: 'season_podium',
            object: { kind: 'season', id: SEASON, title: 'Сезон 2026' },
          }),
        ],
      }),
    );
    mocked.revokeRiderAchievement.mockResolvedValue(undefined);
    await open();
    const block = await section();
    fireEvent.click(
      await within(block).findByRole('button', {
        name: 'Отозвать: Призёр сезона, Сезон · Сезон 2026',
      }),
    );
    expect(
      within(dialog()).getByRole('heading', { name: 'Отозвать «Призёр сезона»' }),
    ).toBeTruthy();
    expect(
      within(dialog()).getByText(
        'Достижение пропадёт у райдера без уведомления. Автоматика не вернёт его, пока решение не снимут.',
      ),
    ).toBeTruthy();
    expect(within(dialog()).getByText(WARNING)).toBeTruthy();
    const confirm = within(dialog()).getByRole('button', { name: 'Отозвать' });
    expect(confirm.className).toContain('button--danger-solid');
    mocked.getRiderAchievements.mockRejectedValue(networkError());
    fillReason('нечестный результат');
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.revokeRiderAchievement).toHaveBeenCalledWith(ID, {
        code: 'season_podium',
        seasonId: SEASON,
        reason: 'нечестный результат',
      }),
    );
    expect(await within(block).findByText('Не удалось обновить данные')).toBeTruthy();
    expect(within(block).getByText('Сезон · Сезон 2026')).toBeTruthy();
  });

  it('409 `not_granted` на отзыв — текст в окне и перечитывание', async () => {
    mocked.revokeRiderAchievement.mockRejectedValue(
      httpError(409, 'ACHIEVEMENT_INVALID_STATE', { reason: 'not_granted' }),
    );
    await open();
    const block = await section();
    fireEvent.click(
      await within(block).findByRole('button', {
        name: 'Отозвать: Подиум, Гонка · Минская сотка',
      }),
    );
    fillReason();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Отозвать' }));
    expect(
      await within(dialog()).findByText('Достижение уже отозвано — список обновлён.'),
    ).toBeTruthy();
    await waitFor(() => expect(mocked.getRiderAchievements).toHaveBeenCalledTimes(2));
    expect(mocked.revokeRiderAchievement).toHaveBeenCalledWith(ID, {
      code: 'race_podium',
      reason: 'технический сбой',
    });
  });

  it('«Вернуть автоматике» — не деструктивное окно; `reconciled: false` — баннер о пересчёте', async () => {
    mocked.clearRiderAchievementOverride.mockResolvedValue({ cleared: true, reconciled: false });
    await open();
    const block = await section();
    fireEvent.click(
      await within(block).findByRole('button', {
        name: 'Вернуть автоматике: Первый маршрут, Объект недоступен ·9a8102',
      }),
    );
    expect(
      within(dialog()).getByText('Решение снимется, выдачу пересчитают по фактам сразу.'),
    ).toBeTruthy();
    const confirm = within(dialog()).getByRole('button', { name: 'Вернуть автоматике' });
    expect(confirm.className).toContain('button--primary');
    fillReason('сбой исправлен');
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.clearRiderAchievementOverride).toHaveBeenCalledWith(ID, {
        code: 'route_first',
        reason: 'сбой исправлен',
      }),
    );
    expect(
      await within(block).findByText('Пересчёт по фактам выполнится при следующем входе райдера.'),
    ).toBeTruthy();
  });
});
