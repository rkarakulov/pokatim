// @vitest-environment jsdom
import type { RiderProfileModerationDetail } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listRiderProfiles: vi.fn(),
    getRiderProfile: vi.fn(),
    resetRiderAvatar: vi.fn(),
    resetRiderClub: vi.fn(),
    resetRiderName: vi.fn(),
    dismissRiderProfileReports: vi.fn(),
    riderAvatarUrl: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const REPORT = '01890a5d-ac96-774b-bcce-b302099a8092';
const AVATAR = 'Ab3dEf6hIj9kLm2nOp5qRs';
const LAST = '2026-10-01T10:00:00.000Z';
const WARNING = 'Не повторяйте имя или клуб в причине: она навсегда остаётся в журнале действий.';

const detail = (
  overrides: Partial<RiderProfileModerationDetail> = {},
): RiderProfileModerationDetail => ({
  userId: ID,
  name: 'Анна К.',
  club: 'Веломинск',
  avatar: { id: AVATAR },
  isPublic: true,
  openReportCount: 1,
  lastReportAt: LAST,
  reportRevision: 4,
  avatarUploadBlockedUntil: null,
  avatarResetCount: 0,
  reports: [
    {
      id: REPORT,
      reason: 'club',
      comment: 'Клуб с рекламой',
      createdAt: LAST,
      resolution: null,
      resolvedAt: null,
    },
  ],
  ...overrides,
});

const open = () => renderApp(`/rider-profiles/${ID}`);
const dialog = () => screen.getByRole('dialog');
const confirmWith = async (button: string, reason: string) => {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value: reason } });
  fireEvent.click(within(dialog()).getByRole('button', { name: button }));
};

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.getRiderProfile.mockResolvedValue(detail());
  mocked.riderAvatarUrl.mockImplementation((id: string) => `/v1/avatars/${id}`);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('карточка профиля райдера (profile-moderation, AC10)', () => {
  it('фото, подпись, клуб, статус, жалобы без автора; четыре действия', async () => {
    await open();
    expect(await screen.findByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
    const photo = screen.getByRole('img', { name: 'Фото профиля Анна К. ·9a8090' });
    expect(photo.getAttribute('src')).toBe(`/v1/avatars/${AVATAR}`);
    expect(mocked.riderAvatarUrl).toHaveBeenCalledWith(AVATAR);
    for (const text of [
      'Публичный',
      'Веломинск',
      'Неприемлемый клуб',
      'Клуб с рекламой',
      'Открыта',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    for (const name of ['Сбросить фото', 'Сбросить клуб', 'Сбросить имя', 'Отклонить жалобы']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled'), name).toBe(false);
    }
  });

  it('скрытый райдером без фото, клуба и имени: пустой квадрат, «Скрыт райдером», сбросы неактивны с причиной; без открытых жалоб — нет «Отклонить жалобы»', async () => {
    mocked.getRiderProfile.mockResolvedValue(
      detail({
        name: null,
        club: null,
        avatar: null,
        isPublic: false,
        openReportCount: 0,
        reports: [{ ...detail().reports[0]!, resolution: 'actioned', resolvedAt: LAST }],
      }),
    );
    await open();
    expect(await screen.findByRole('heading', { name: 'Участник ·9a8090' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Фото нет' })).toBeTruthy();
    expect(screen.getByText('Скрыт райдером')).toBeTruthy();
    expect(screen.getByText('Закрыта сбросом')).toBeTruthy();
    for (const name of ['Сбросить фото', 'Сбросить клуб', 'Сбросить имя']) {
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled'), name).toBe(true);
      const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent, name).toBe('Сбросить можно только то, что есть в профиле.');
    }
    expect(screen.queryByRole('button', { name: 'Отклонить жалобы' })).toBeNull();
    expect(mocked.riderAvatarUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['Сбросить фото', 'resetRiderAvatar'],
    ['Сбросить клуб', 'resetRiderClub'],
    ['Сбросить имя', 'resetRiderName'],
  ] as const)(
    '«%s» — ReasonDialog с предупреждением D11; запрос с причиной, карточка перечитана',
    async (button, method) => {
      mocked[method].mockResolvedValue({ reset: true });
      await open();
      fireEvent.click(await screen.findByRole('button', { name: button }));
      expect(within(dialog()).getByText(WARNING)).toBeTruthy();
      const confirm = within(dialog()).getByRole('button', { name: button });
      fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value: 'ab' } });
      expect(confirm.hasAttribute('disabled')).toBe(true);
      fireEvent.change(within(dialog()).getByLabelText(/Причина/), {
        target: { value: 'Реклама в профиле' },
      });
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(mocked[method]).toHaveBeenCalledWith(ID, { reason: 'Реклама в профиле' }),
      );
      await waitFor(() => expect(mocked.getRiderProfile).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('«Отклонить жалобы» — с reportRevision карточки и предупреждением', async () => {
    mocked.dismissRiderProfileReports.mockResolvedValue({ dismissed: true });
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить жалобы' }));
    expect(within(dialog()).getByText(WARNING)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Отмена/ }));
    await confirmWith('Отклонить жалобы', 'Нарушений нет');
    await waitFor(() =>
      expect(mocked.dismissRiderProfileReports).toHaveBeenCalledWith(ID, {
        reason: 'Нарушений нет',
        reportRevision: 4,
      }),
    );
  });

  it('409 CONFLICT — «Пришли новые жалобы, обновите карточку», «Обновить» перечитывает', async () => {
    mocked.dismissRiderProfileReports.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    await confirmWith('Отклонить жалобы', 'Нарушений нет');
    expect(await screen.findByText('Пришли новые жалобы, обновите карточку')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    mocked.getRiderProfile.mockResolvedValue(detail({ openReportCount: 2, reportRevision: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() =>
      expect(screen.queryByText('Пришли новые жалобы, обновите карточку')).toBeNull(),
    );
    mocked.dismissRiderProfileReports.mockResolvedValue({ dismissed: true });
    await confirmWith('Отклонить жалобы', 'Нарушений нет');
    await waitFor(() =>
      expect(mocked.dismissRiderProfileReports).toHaveBeenLastCalledWith(ID, {
        reason: 'Нарушений нет',
        reportRevision: 5,
      }),
    );
  });

  it('ошибка сервера в действии — текст в окне, окно открыто', async () => {
    mocked.resetRiderClub.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    await confirmWith('Сбросить клуб', 'Реклама в клубе');
    expect(await within(dialog()).findByRole('alert')).toBeTruthy();
  });

  it('404 при действии (профиль удалён) — окно закрыто, карточка перечитана: «Профиль не найден» без действий', async () => {
    mocked.resetRiderClub.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await open();
    await screen.findByRole('heading', { name: 'Анна К. ·9a8090' });
    mocked.getRiderProfile.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await confirmWith('Сбросить клуб', 'Реклама в клубе');
    expect(await screen.findByText('Профиль не найден')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Не удалось сохранить')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сбросить фото' })).toBeNull();
  });

  it.each([
    ['500', () => httpError(500, 'INTERNAL')],
    ['сбой сети', networkError],
  ])(
    'ошибка перечитывания (%s) при показанной карточке — данные остаются, баннер с повтором',
    async (_, error) => {
      await open();
      await screen.findByRole('heading', { name: 'Анна К. ·9a8090' });
      mocked.getRiderProfile.mockRejectedValue(error());
      mocked.dismissRiderProfileReports.mockResolvedValue({ dismissed: true });
      await confirmWith('Отклонить жалобы', 'Нарушений нет');
      expect(await screen.findByText('Не удалось обновить данные')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
      expect(screen.getByText('Клуб с рекламой')).toBeTruthy();

      mocked.getRiderProfile.mockResolvedValue(detail({ openReportCount: 0, club: null }));
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      await waitFor(() => expect(screen.queryByText('Не удалось обновить данные')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Отклонить жалобы' })).toBeNull();
    },
  );

  it('сброс выполнен, перечитывание упало 500 — баннер с повтором поверх прежней карточки', async () => {
    mocked.resetRiderAvatar.mockResolvedValue({ reset: true });
    await open();
    await screen.findByRole('heading', { name: 'Анна К. ·9a8090' });
    mocked.getRiderProfile.mockRejectedValue(httpError(500, 'INTERNAL'));
    await confirmWith('Сбросить фото', 'Фото с рекламой');
    expect(await screen.findByText('Не удалось обновить данные')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Анна К. ·9a8090' })).toBeTruthy();
  });

  it('карточка загружена, перечитывание — 404: «Профиль не найден» вместо старой карточки и действий', async () => {
    mocked.resetRiderName.mockResolvedValue({ reset: true });
    await open();
    await screen.findByRole('heading', { name: 'Анна К. ·9a8090' });
    mocked.getRiderProfile.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await confirmWith('Сбросить имя', 'Имя оскорбительное');
    expect(await screen.findByText('Профиль не найден')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Анна К. ·9a8090' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сбросить клуб' })).toBeNull();
  });

  it('карточка загружена, перечитывание — 403: «Нет доступа»', async () => {
    mocked.resetRiderClub.mockResolvedValue({ reset: true });
    await open();
    await screen.findByRole('heading', { name: 'Анна К. ·9a8090' });
    mocked.getRiderProfile.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await confirmWith('Сбросить клуб', 'Реклама в клубе');
    expect(await screen.findByText(/Нет доступа/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сбросить клуб' })).toBeNull();
  });

  it('404 — «Профиль не найден»; ошибка — с повтором; загрузка — скелетон', async () => {
    mocked.getRiderProfile.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await open();
    expect(await screen.findByText('Профиль не найден')).toBeTruthy();
    cleanup();

    mocked.getRiderProfile.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    cleanup();

    mocked.getRiderProfile.mockReturnValue(new Promise(() => undefined));
    await open();
    expect((await screen.findAllByTestId('skeleton-field')).length).toBeGreaterThan(0);
  });

  it('organizer — «Нет доступа к разделу», без запроса', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await open();
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
    expect(mocked.getRiderProfile).not.toHaveBeenCalled();
  });
});
