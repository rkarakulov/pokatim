// @vitest-environment jsdom
import type { ModerationRideDetail } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, mountPanelCss, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listModerationRides: vi.fn(),
    getModerationRide: vi.fn(),
    hideRide: vi.fn(),
    restoreRide: vi.fn(),
    dismissRideReports: vi.fn(),
    resetRidePhoto: vi.fn(),
    moderationRidePhotoUrl: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const REPORT = '01890a5d-ac96-774b-bcce-b302099a8081';
const LAST = '2026-10-01T10:00:00.000Z';
const PHOTO = 'p'.repeat(43);
const photoUrl = (photoId: string) =>
  `https://api.test/v1/admin/rides/${ID}/photo?photoId=${photoId}`;
const PHOTO_URL = photoUrl(PHOTO);

const detail = (overrides: Partial<ModerationRideDetail> = {}): ModerationRideDetail => ({
  id: ID,
  title: 'Кофе-райд на море',
  organizerName: 'Катя',
  startsAt: '2026-10-04T07:00:00.000Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  description: 'Едем спокойно',
  status: 'published',
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  hiddenAt: null,
  openReportCount: 1,
  lastReportAt: LAST,
  version: 2,
  reports: [
    {
      id: REPORT,
      reason: 'offensive',
      comment: 'Мат в описании',
      createdAt: LAST,
      resolution: null,
      resolvedAt: null,
    },
  ],
  photo: null,
  ...overrides,
});

const open = () => renderApp(`/rides-moderation/${ID}`);
const dialog = () => screen.getByRole('dialog');
const confirmWith = async (button: string, reason: string, confirm: string) => {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value: reason } });
  fireEvent.click(within(dialog()).getByRole('button', { name: confirm }));
};

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.getModerationRide.mockResolvedValue(detail());
  mocked.moderationRidePhotoUrl.mockImplementation(
    (rideId, photoId) => `https://api.test/v1/admin/rides/${rideId}/photo?photoId=${photoId}`,
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('карточка модерации (05b, AC4–AC6, AC8)', () => {
  it('превью райда целиком и жалобы (без автора); опубликованный с жалобами — «Скрыть» и «Отклонить жалобы»', async () => {
    await open();
    expect(await screen.findByRole('heading', { name: 'Кофе-райд на море' })).toBeTruthy();
    for (const text of [
      'Опубликован',
      '4 октября 2026, 10:00',
      'Минск',
      'Парк Победы',
      '42 км',
      '22–24 км/ч',
      '12',
      '5',
      'Едем спокойно',
      'Катя',
      'Оскорбления или неприемлемый текст',
      'Мат в описании',
      'Открыта',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: 'Скрыть' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить жалобы' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Вернуть' })).toBeNull();
  });

  it('описание — с переносами строк, как в приложении (B17)', async () => {
    mountPanelCss();
    mocked.getModerationRide.mockResolvedValue(
      detail({ description: 'Первый абзац.\n\nТестовые данные dev.' }),
    );
    await open();
    const description = await screen.findByText(/Первый абзац\./);
    expect(description.textContent).toBe('Первый абзац.\n\nТестовые данные dev.');
    expect(getComputedStyle(description).whiteSpace).toBe('pre-line');
  });

  it('без открытых жалоб — только «Скрыть»; скрытый — только «Вернуть»', async () => {
    mocked.getModerationRide.mockResolvedValue(detail({ openReportCount: 0, reports: [] }));
    await open();
    expect(await screen.findByRole('button', { name: 'Скрыть' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отклонить жалобы' })).toBeNull();
    expect(screen.getByText('Жалоб нет')).toBeTruthy();
    cleanup();

    mocked.getModerationRide.mockResolvedValue(
      detail({
        status: 'hidden',
        phase: 'hidden',
        openReportCount: 0,
        hiddenAt: LAST,
        reports: [{ ...detail().reports[0]!, resolution: 'hidden', resolvedAt: LAST }],
      }),
    );
    await open();
    expect(await screen.findByRole('button', { name: 'Вернуть' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отклонить жалобы' })).toBeNull();
    expect(screen.getByText('Закрыта: райд скрыт')).toBeTruthy();
  });

  it('«Скрыть» — ReasonDialog: причина короче 3 — подтверждение выключено; затем запрос с version и причиной', async () => {
    mocked.hideRide.mockResolvedValue(detail({ status: 'hidden', phase: 'hidden', version: 3 }));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть' }));
    const confirm = within(dialog()).getByRole('button', { name: 'Скрыть' });
    fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value: 'ab' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog()).getByLabelText(/Причина/), {
      target: { value: 'Оскорбления' },
    });
    mocked.getModerationRide.mockResolvedValue(
      detail({ status: 'hidden', phase: 'hidden', version: 3, openReportCount: 0 }),
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.hideRide).toHaveBeenCalledWith(ID, { version: 2, reason: 'Оскорбления' }),
    );
    expect(await screen.findByRole('button', { name: 'Вернуть' })).toBeTruthy();
  });

  it('«Отклонить жалобы» — с lastReportAt карточки; «Вернуть» — с version', async () => {
    mocked.dismissRideReports.mockResolvedValue(detail({ openReportCount: 0 }));
    await open();
    await confirmWith('Отклонить жалобы', 'Нарушений нет', 'Отклонить жалобы');
    await waitFor(() =>
      expect(mocked.dismissRideReports).toHaveBeenCalledWith(ID, {
        version: 2,
        reason: 'Нарушений нет',
        lastReportAt: LAST,
      }),
    );
    cleanup();

    mocked.getModerationRide.mockResolvedValue(
      detail({ status: 'hidden', phase: 'hidden', version: 5, openReportCount: 0 }),
    );
    mocked.restoreRide.mockResolvedValue(detail({ version: 6 }));
    await open();
    await confirmWith('Вернуть', 'Ошибочное скрытие', 'Вернуть');
    await waitFor(() =>
      expect(mocked.restoreRide).toHaveBeenCalledWith(ID, {
        version: 5,
        reason: 'Ошибочное скрытие',
      }),
    );
  });

  it.each([['CONFLICT'], ['RIDE_INVALID_STATE']])(
    '409 %s — ConflictBanner, «Обновить» перечитывает карточку',
    async (code) => {
      mocked.hideRide.mockRejectedValue(httpError(409, code));
      await open();
      await confirmWith('Скрыть', 'Оскорбления', 'Скрыть');
      expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      mocked.getModerationRide.mockResolvedValue(
        detail({ status: 'hidden', phase: 'hidden', version: 3, openReportCount: 0 }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
      expect(await screen.findByRole('button', { name: 'Вернуть' })).toBeTruthy();
      expect(screen.queryByText('Запись изменили — обновите страницу')).toBeNull();
    },
  );

  it('404 — «Райд не найден»; ошибка — с повтором; загрузка — скелетон', async () => {
    mocked.getModerationRide.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await open();
    expect(await screen.findByText('Райд не найден')).toBeTruthy();
    cleanup();

    mocked.getModerationRide.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    cleanup();

    mocked.getModerationRide.mockReturnValue(new Promise(() => undefined));
    await open();
    expect((await screen.findAllByTestId('skeleton-field')).length).toBeGreaterThan(0);
  });
});

describe('фото организатора в карточке (ride-photo, P7, AC8, R10, R11; followups AC6)', () => {
  const HIDDEN = { status: 'hidden', phase: 'hidden', hiddenAt: LAST } as const;
  const resetPhotoButton = () => screen.queryByRole('button', { name: 'Удалить фото' });
  const HIDDEN_NOTE = 'Райд скрыт — райдеры это фото не видят';

  it('без фото — «Нет фото», кнопки «Удалить фото» нет', async () => {
    await open();
    expect(await screen.findByRole('heading', { name: 'Кофе-райд на море' })).toBeTruthy();
    expect(screen.getByText('Нет фото')).toBeTruthy();
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    expect(resetPhotoButton()).toBeNull();
  });

  it('видимый райд с фото — картинка по админскому адресу с photoId, без пометки; «Удалить фото»', async () => {
    mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
    await open();
    const img = await screen.findByAltText('Фото организатора «Кофе-райд на море»');
    expect(img.getAttribute('src')).toBe(PHOTO_URL);
    expect(mocked.moderationRidePhotoUrl).toHaveBeenCalledWith(ID, PHOTO);
    expect(resetPhotoButton()).toBeTruthy();
    expect(screen.queryByText(HIDDEN_NOTE)).toBeNull();
  });

  it('скрытый райд с фото — та же картинка по админскому адресу и пометка; «Удалить фото» доступна (R11 b)', async () => {
    mocked.getModerationRide.mockResolvedValue(
      detail({ ...HIDDEN, openReportCount: 0, photo: { id: PHOTO } }),
    );
    await open();
    const img = await screen.findByAltText('Фото организатора «Кофе-райд на море»');
    expect(img.getAttribute('src')).toBe(PHOTO_URL);
    expect(mocked.moderationRidePhotoUrl).toHaveBeenCalledWith(ID, PHOTO);
    expect(screen.getByText(HIDDEN_NOTE)).toBeTruthy();
    expect(resetPhotoButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вернуть' })).toBeTruthy();
  });

  it('скрытый райд: картинка не загрузилась — «Фото недоступно» с повтором, пометка остаётся', async () => {
    mocked.getModerationRide.mockResolvedValue(
      detail({ ...HIDDEN, openReportCount: 0, photo: { id: PHOTO } }),
    );
    await open();
    await screen.findByTestId('ride-photo-skeleton');
    fireEvent.error(screen.getByAltText('Фото организатора «Кофе-райд на море»'));
    expect(screen.getByText(/Фото недоступно/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Обновить карточку' })).toBeTruthy();
    expect(screen.getByText(HIDDEN_NOTE)).toBeTruthy();
  });

  it('«Удалить фото» — ReasonDialog с предупреждением; запрос с photoId карточки и причиной; карточка перечитана', async () => {
    mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
    mocked.resetRidePhoto.mockResolvedValue(detail());
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить фото' }));
    expect(within(dialog()).getByText('Удалить фото райда «Кофе-райд на море»?')).toBeTruthy();
    expect(
      within(dialog()).getByText(
        'Причина видна команде: она навсегда остаётся в журнале действий.',
      ),
    ).toBeTruthy();
    const confirm = within(dialog()).getByRole('button', { name: 'Удалить фото' });
    fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value: 'ab' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog()).getByLabelText(/Причина/), {
      target: { value: 'Чужое фото' },
    });
    mocked.getModerationRide.mockResolvedValue(detail());
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.resetRidePhoto).toHaveBeenCalledWith(ID, {
        photoId: PHOTO,
        reason: 'Чужое фото',
      }),
    );
    expect(await screen.findByText('Нет фото')).toBeTruthy();
    expect(resetPhotoButton()).toBeNull();
    expect(mocked.hideRide).not.toHaveBeenCalled();
  });

  it('409 CONFLICT — «Фото уже изменилось», «Обновить» перечитывает карточку (R10)', async () => {
    const NEXT = 'q'.repeat(43);
    mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
    mocked.resetRidePhoto.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    await confirmWith('Удалить фото', 'Чужое фото', 'Удалить фото');
    expect(await screen.findByText('Фото уже изменилось — обновите карточку')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: NEXT } }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { hidden: true }).getAttribute('src')).toBe(photoUrl(NEXT)),
    );
    expect(screen.queryByText('Фото уже изменилось — обновите карточку')).toBeNull();
  });

  it('прочая ошибка — текст в окне причины, окно не закрывается', async () => {
    mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
    mocked.resetRidePhoto.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    await confirmWith('Удалить фото', 'Чужое фото', 'Удалить фото');
    expect(await within(dialog()).findByText(/Не удалось сохранить/)).toBeTruthy();
  });

  describe('загрузка картинки (ревью pass 1, HIGH)', () => {
    const photoImg = () => screen.getByAltText('Фото организатора «Кофе-райд на море»');

    it('до onLoad — скелетон превью, картинка скрыта; после — скелетона нет', async () => {
      mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
      await open();
      expect(await screen.findByTestId('ride-photo-skeleton')).toBeTruthy();
      expect(photoImg().hidden).toBe(true);
      fireEvent.load(photoImg());
      expect(screen.queryByTestId('ride-photo-skeleton')).toBeNull();
      expect(photoImg().hidden).toBe(false);
    });

    it('onError — «Фото недоступно»; «Повторить» перемонтирует картинку, «Обновить карточку» — перечитывает', async () => {
      mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
      await open();
      await screen.findByTestId('ride-photo-skeleton');
      const first = photoImg();
      fireEvent.error(first);
      expect(screen.getByText(/Фото недоступно/)).toBeTruthy();
      expect(screen.queryByRole('img', { hidden: true })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(screen.queryByText(/Фото недоступно/)).toBeNull();
      expect(screen.getByTestId('ride-photo-skeleton')).toBeTruthy();
      expect(photoImg()).not.toBe(first);
      fireEvent.load(photoImg());
      expect(photoImg().hidden).toBe(false);

      fireEvent.error(photoImg());
      const calls = mocked.getModerationRide.mock.calls.length;
      mocked.getModerationRide.mockResolvedValue(detail({ photo: null }));
      fireEvent.click(screen.getByRole('button', { name: 'Обновить карточку' }));
      expect(await screen.findByText('Нет фото')).toBeTruthy();
      expect(mocked.getModerationRide.mock.calls.length).toBeGreaterThan(calls);
    });

    it('смена photo.id сбрасывает состояние ошибки', async () => {
      const NEXT = 'q'.repeat(43);
      mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: PHOTO } }));
      await open();
      await screen.findByTestId('ride-photo-skeleton');
      fireEvent.error(photoImg());
      mocked.getModerationRide.mockResolvedValue(detail({ photo: { id: NEXT } }));
      fireEvent.click(screen.getByRole('button', { name: 'Обновить карточку' }));
      await waitFor(() => expect(photoImg().getAttribute('src')).toBe(photoUrl(NEXT)));
      expect(screen.queryByText(/Фото недоступно/)).toBeNull();
      expect(screen.getByTestId('ride-photo-skeleton')).toBeTruthy();
    });
  });
});
