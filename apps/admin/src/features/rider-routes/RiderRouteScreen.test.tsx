// @vitest-environment jsdom
import type { RiderRouteModerationDetail } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp } from '../../test/app';
import { loadMaplibre } from '../maps/load-maplibre';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listRiderRoutes: vi.fn(),
    getRiderRoute: vi.fn(),
    approveRiderRoute: vi.fn(),
    rejectRiderRoute: vi.fn(),
    hideRiderRoute: vi.fn(),
    restoreRiderRoute: vi.fn(),
    dismissRiderRouteReports: vi.fn(),
  },
}));
// jsdom без WebGL: карта не грузится
vi.mock('../maps/load-maplibre', () => ({ loadMaplibre: vi.fn() }));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const AUTHOR = '01890a5d-ac96-774b-bcce-b302099a80a1';
const REPORT = '01890a5d-ac96-774b-bcce-b302099a8081';
const LAST = '2026-10-05T09:00:00.000Z';

const detail = (
  overrides: Partial<RiderRouteModerationDetail> = {},
): RiderRouteModerationDetail => ({
  id: ID,
  title: 'Вокруг Минского моря',
  authorUserId: AUTHOR,
  showAuthorName: true,
  status: 'pending',
  city: 'minsk',
  surfaces: ['asphalt'],
  submittedAt: '2026-10-04T07:00:00.000Z',
  submissionCount: 1,
  decidedAt: null,
  approvedAt: null,
  rejection: null,
  hiddenAt: null,
  openReportCount: 0,
  lastReportAt: null,
  reportRevision: 0,
  version: 2,
  distanceM: 42_300,
  elevationGainM: 180,
  isLoop: true,
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
  ],
  elevation: {
    minM: 191,
    maxM: 267,
    profile: [
      [0, 200],
      [21_000, 267],
      [42_300, 191],
    ],
  },
  reports: [],
  ...overrides,
});

const approvedWithReport = () =>
  detail({
    status: 'approved',
    decidedAt: '2026-10-04T08:00:00.000Z',
    approvedAt: '2026-10-04T08:00:00.000Z',
    openReportCount: 1,
    lastReportAt: LAST,
    reportRevision: 3,
    reports: [
      {
        id: REPORT,
        reason: 'private_area',
        comment: 'Через закрытую базу',
        createdAt: LAST,
        resolution: null,
        resolvedAt: null,
      },
    ],
  });

const open = () => renderApp(`/rider-routes/${ID}`);
const dialog = () => screen.getByRole('dialog');
const tile = (label: string) =>
  screen
    .getByRole('group', { name: label })
    .textContent?.replace(label, '')
    .replace(/\u00a0/g, ' ');
const confirmWithReason = async (button: string, reason: string) => {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  fireEvent.change(within(dialog()).getByLabelText(/Причина/), { target: { value: reason } });
  fireEvent.click(within(dialog()).getByRole('button', { name: button }));
};

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.getRiderRoute.mockResolvedValue(detail());
  vi.mocked(loadMaplibre).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('страница заявки райдера (routes-06, AC1–AC5, N7, N8)', () => {
  it('заявка: автор только id, подпись, город, покрытие; карта, цифры и профиль — блок страницы маршрута', async () => {
    await open();
    expect(
      await screen.findByRole('heading', { name: 'Вокруг Минского моря', level: 1 }),
    ).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Маршруты райдеров' }).length).toBeGreaterThan(0);
    for (const text of [
      'На проверке',
      'Райдер ·9a80a1',
      'Имя из профиля автора',
      'Минск',
      'Асфальт',
      '4 октября 2026, 10:00',
      '1 из 3',
      'Жалоб нет',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    // RouteReadyView (routes-05): линия без env стиля, цифры, профиль-слайдер
    expect(screen.getByRole('img', { name: /Линия маршрута «Вокруг Минского моря»/ })).toBeTruthy();
    expect(tile('Длина')).toBe('42,3 км');
    expect(tile('Набор')).toBe('180 м');
    expect(tile('Форма')).toBe('Круговой');
    expect(screen.getByRole('slider')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Одобрить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull();
  });

  it('«Одобрить» — город и покрытие из заявки, правка уходит в запрос с version', async () => {
    mocked.approveRiderRoute.mockResolvedValue(detail({ status: 'approved', version: 3 }));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Одобрить' }));
    expect(within(dialog()).getByText(/линия, старт и финиш станут видны всем/)).toBeTruthy();
    const city = within(dialog()).getByLabelText('Город старта') as HTMLSelectElement;
    expect(city.value).toBe('minsk');
    fireEvent.change(city, { target: { value: 'brest' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Гравий' }));
    mocked.getRiderRoute.mockResolvedValue(detail({ status: 'approved', version: 3 }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Одобрить' }));
    await waitFor(() =>
      expect(mocked.approveRiderRoute).toHaveBeenCalledWith(ID, {
        version: 2,
        city: 'brest',
        surfaces: ['asphalt', 'gravel'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Скрыть' })).toBeTruthy();
  });

  it('«Отклонить» — без причины подтверждение выключено; причина из справочника и комментарий автору', async () => {
    mocked.rejectRiderRoute.mockResolvedValue(detail({ status: 'rejected', version: 3 }));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }));
    const confirm = within(dialog()).getByRole('button', { name: 'Отклонить' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog()).getByLabelText('Неподходящее название'));
    expect(confirm.hasAttribute('disabled')).toBe(false);
    const comment = within(dialog()).getByLabelText(/Комментарий автору/) as HTMLTextAreaElement;
    expect(comment.maxLength).toBe(500);
    fireEvent.change(comment, { target: { value: 'Уберите адрес из названия' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.rejectRiderRoute).toHaveBeenCalledWith(ID, {
        version: 2,
        reason: 'bad_title',
        comment: 'Уберите адрес из названия',
      }),
    );
  });

  it('отклонённая — причина и комментарий автору, действий нет', async () => {
    mocked.getRiderRoute.mockResolvedValue(
      detail({
        status: 'rejected',
        decidedAt: '2026-10-04T08:00:00.000Z',
        rejection: { reason: 'duplicate', comment: 'Уже есть в каталоге' },
      }),
    );
    await open();
    expect(await screen.findByText('Дубль')).toBeTruthy();
    expect(screen.getByText('Уже есть в каталоге')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Одобрить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull();
  });

  it('в каталоге с жалобой: жалоба без автора; «Отклонить жалобы» — с reportRevision; «Скрыть» — с причиной', async () => {
    mocked.getRiderRoute.mockResolvedValue(approvedWithReport());
    mocked.dismissRiderRouteReports.mockResolvedValue(detail({ status: 'approved', version: 2 }));
    await open();
    expect(await screen.findByText('Частная или закрытая территория')).toBeTruthy();
    expect(screen.getByText('Через закрытую базу')).toBeTruthy();
    expect(screen.getByText('Открыта')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Вернуть' })).toBeNull();
    await confirmWithReason('Отклонить жалобы', 'Нарушений нет');
    await waitFor(() =>
      expect(mocked.dismissRiderRouteReports).toHaveBeenCalledWith(ID, {
        version: 2,
        reason: 'Нарушений нет',
        reportRevision: 3,
      }),
    );
    cleanup();

    mocked.getRiderRoute.mockResolvedValue(approvedWithReport());
    mocked.hideRiderRoute.mockResolvedValue(detail({ status: 'hidden', version: 3 }));
    await open();
    await confirmWithReason('Скрыть', 'Частная территория');
    await waitFor(() =>
      expect(mocked.hideRiderRoute).toHaveBeenCalledWith(ID, {
        version: 2,
        reason: 'Частная территория',
      }),
    );
  });

  it('скрытый — только «Вернуть» с причиной', async () => {
    mocked.getRiderRoute.mockResolvedValue(
      detail({ status: 'hidden', hiddenAt: LAST, version: 5 }),
    );
    mocked.restoreRiderRoute.mockResolvedValue(detail({ status: 'approved', version: 6 }));
    await open();
    expect(await screen.findByRole('button', { name: 'Вернуть' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull();
    await confirmWithReason('Вернуть', 'Ошибочное скрытие');
    await waitFor(() =>
      expect(mocked.restoreRiderRoute).toHaveBeenCalledWith(ID, {
        version: 5,
        reason: 'Ошибочное скрытие',
      }),
    );
  });

  it.each([
    ['409 CONFLICT', () => httpError(409, 'CONFLICT')],
    ['409 ROUTE_INVALID_STATE', () => httpError(409, 'ROUTE_INVALID_STATE')],
    ['404 (автор отозвал заявку)', () => httpError(404, 'NOT_FOUND')],
  ])(
    '%s при решении — «Заявку уже изменили — обновите страницу», «Обновить» перечитывает',
    async (_, error) => {
      mocked.approveRiderRoute.mockRejectedValue(error());
      await open();
      fireEvent.click(await screen.findByRole('button', { name: 'Одобрить' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Одобрить' }));
      expect(await screen.findByText('Заявку уже изменили — обновите страницу')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      mocked.getRiderRoute.mockResolvedValue(detail({ status: 'approved', version: 3 }));
      fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
      expect(await screen.findByRole('button', { name: 'Скрыть' })).toBeTruthy();
      expect(screen.queryByText('Заявку уже изменили — обновите страницу')).toBeNull();
    },
  );

  const conflictThenReload = async () => {
    mocked.approveRiderRoute.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Одобрить' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Одобрить' }));
    expect(await screen.findByText('Заявку уже изменили — обновите страницу')).toBeTruthy();
  };

  it('«Обновить» при 404 (заявку отозвали) — «Заявка не найдена» без линии и действий', async () => {
    await conflictThenReload();
    mocked.getRiderRoute.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText('Заявка не найдена')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Одобрить' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Линия маршрута/ })).toBeNull();
    expect(screen.queryByText('Заявку уже изменили — обновите страницу')).toBeNull();
  });

  it('«Обновить» при сбое сети/5xx — данные остаются, баннер ошибки с повтором, конфликт не снят', async () => {
    await conflictThenReload();
    mocked.getRiderRoute.mockRejectedValue(httpError(500, 'INTERNAL'));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText('Не удалось обновить данные')).toBeTruthy();
    expect(screen.getByText('Заявку уже изменили — обновите страницу')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Вокруг Минского моря', level: 1 })).toBeTruthy();

    mocked.getRiderRoute.mockResolvedValue(detail({ status: 'approved', version: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Скрыть' })).toBeTruthy();
    expect(screen.queryByText('Не удалось обновить данные')).toBeNull();
    expect(screen.queryByText('Заявку уже изменили — обновите страницу')).toBeNull();
  });

  it('«Обновить» при 403 — «Нет доступа»', async () => {
    await conflictThenReload();
    mocked.getRiderRoute.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText(/Нет доступа/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Одобрить' })).toBeNull();
  });

  it('409 при «Скрыть» (новая жалоба/версия) — тот же баннер, окно причины закрыто', async () => {
    mocked.getRiderRoute.mockResolvedValue(approvedWithReport());
    mocked.hideRiderRoute.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    await confirmWithReason('Скрыть', 'Частная территория');
    expect(await screen.findByText('Заявку уже изменили — обновите страницу')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('прочая ошибка решения — текст в окне, окно остаётся', async () => {
    mocked.rejectRiderRoute.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }));
    fireEvent.click(within(dialog()).getByLabelText('Дубль'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Отклонить' }));
    expect(await within(dialog()).findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Заявку уже изменили — обновите страницу')).toBeNull();
  });

  it('404 — «Заявка не найдена»; ошибка — с повтором; загрузка — скелетон', async () => {
    mocked.getRiderRoute.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await open();
    expect(await screen.findByText('Заявка не найдена')).toBeTruthy();
    cleanup();

    mocked.getRiderRoute.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    cleanup();

    mocked.getRiderRoute.mockReturnValue(new Promise(() => undefined));
    await open();
    expect((await screen.findAllByTestId('skeleton-field')).length).toBeGreaterThan(0);
  });
});
