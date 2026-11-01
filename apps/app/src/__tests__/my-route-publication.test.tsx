/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { MyRoute, MyRoutePublication } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import MyRouteRoute from '../app/routes/mine/[id]';
import MyRoutePublishRoute from '../app/routes/mine/publish/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getMine = jest.mocked(api.getMyRoute);
const listMine = jest.mocked(api.listMyRoutes);
const submit = jest.mocked(api.submitMyRoutePublication);
const unpublish = jest.mocked(api.unpublishMyRoute);
const renameMine = jest.mocked(api.renameMyRoute);
const deleteMine = jest.mocked(api.deleteMyRoute);

const TOKEN = liveSession.accessToken;
const ID = '0190a6f4-0000-7000-8000-000000000001';

const publication = (overrides: Partial<MyRoutePublication> = {}): MyRoutePublication => ({
  status: 'pending',
  city: 'minsk',
  surfaces: ['asphalt'],
  showAuthorName: false,
  submittedAt: '2026-10-27T08:00:00.000Z',
  decidedAt: null,
  rejection: null,
  ...overrides,
});
const mine = (overrides: Partial<MyRoute> = {}): MyRoute => ({
  id: ID,
  title: 'Вечерний круг',
  status: 'ready',
  failure: null,
  distanceM: 42_000,
  elevationGainM: 310,
  isLoop: true,
  createdAt: '2026-10-26T21:30:00.000Z',
  publication: null,
  canPublish: false,
  submissionsExhausted: false,
  ...overrides,
});
const http = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: 'x', ...(details ? { details } : {}) });

const routes = {
  ...tabRoutes,
  'routes/mine/[id]': MyRouteRoute,
  'routes/mine/publish/[id]': MyRoutePublishRoute,
  'routes/[id]': () => <Text>Карточка каталога</Text>,
};
const open = (url: string) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });
const openDetail = () => open(`/routes/mine/${ID}`);
const openPublish = () => open(`/routes/mine/publish/${ID}`);

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  listMine.mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCatalogRoutes).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCatalogRouteCities).mockResolvedValue({ cities: [] });
});
afterEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

describe('карточка своего маршрута: публикация в каталог (routes-06)', () => {
  it('без заявки и canPublish — «Опубликовать» ведёт на экран заявки; не готовый — блока нет', async () => {
    getMine.mockResolvedValue(mine({ canPublish: true }));
    const router = await openDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Опубликовать' }));
    expect(router.getPathname()).toBe(`/routes/mine/publish/${ID}`);
  });

  it('canPublish false (старый API, обработка) — ни «Опубликовать», ни блока', async () => {
    getMine.mockResolvedValue(mine());
    await openDetail();
    expect(await screen.findByText('Загружен')).toBeOnTheScreen();
    expect(screen.queryByText('Публикация в каталоге')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull();
  });

  it('отозван или снят после 3-й подачи — блок с пояснением «использованы все 3 подачи», без «Опубликовать»', async () => {
    getMine.mockResolvedValue(mine({ submissionsExhausted: true }));
    await openDetail();
    expect(await screen.findByText('Публикация в каталоге')).toBeOnTheScreen();
    expect(
      screen.getByText('Подать маршрут снова нельзя: использованы все 3 подачи.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull();
  });

  it.each([
    ['pending', 'На проверке'],
    ['approved', 'В каталоге'],
    ['hidden', 'Скрыт модератором'],
  ] as const)(
    '%s после 3-й подачи — без пояснения «использованы все 3 подачи» (только publication: null и rejected)',
    async (status, label) => {
      getMine.mockResolvedValue(
        mine({ publication: publication({ status }), submissionsExhausted: true }),
      );
      await openDetail();
      expect(await screen.findByText(label)).toBeOnTheScreen();
      expect(
        screen.queryByText('Подать маршрут снова нельзя: использованы все 3 подачи.'),
      ).toBeNull();
    },
  );

  it('«На проверке»: подсказка, название заморожено; «Отозвать заявку» — с подтверждением', async () => {
    getMine.mockResolvedValue(mine({ publication: publication() }));
    unpublish.mockResolvedValue(mine({ canPublish: true }));
    await openDetail();
    expect(await screen.findByText('На проверке')).toBeOnTheScreen();
    expect(
      screen.getByText('Чтобы переименовать маршрут, сначала снимите его с публикации.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Отозвать заявку' }));
    expect(
      screen.getByText('Отозвать заявку? Подача останется в счёте — у маршрута до 3 подач.'),
    ).toBeOnTheScreen();
    expect(unpublish).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Отозвать заявку' }));
    await waitFor(() => expect(unpublish).toHaveBeenCalledWith(TOKEN, ID));
    expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeOnTheScreen();
    expect(screen.queryByText('На проверке')).toBeNull();
    expect(screen.getByRole('button', { name: 'Переименовать' })).toBeOnTheScreen();
  });

  it('«В каталоге»: «Открыть в каталоге» → /routes/<id>; «Снять с публикации» с подтверждением', async () => {
    getMine.mockResolvedValue(mine({ publication: publication({ status: 'approved' }) }));
    unpublish.mockResolvedValue(mine({ canPublish: true }));
    await openDetail();
    expect(await screen.findByText('В каталоге')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с публикации' }));
    expect(
      screen.getByText('Снять маршрут с публикации? Он исчезнет из каталога.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить' }));
    expect(unpublish).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с публикации' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Снять с публикации' }));
    await waitFor(() => expect(unpublish).toHaveBeenCalledWith(TOKEN, ID));
    expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeOnTheScreen();
    expect(screen.queryByText('В каталоге')).toBeNull();
  });

  it('«Открыть в каталоге» → публичная карточка /routes/<id>', async () => {
    getMine.mockResolvedValue(mine({ publication: publication({ status: 'approved' }) }));
    const router = await openDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Открыть в каталоге' }));
    expect(router.getPathname()).toBe(`/routes/${ID}`);
  });

  it('«Снять с публикации»: скрыт модератором за время просмотра — 409 hidden текстом', async () => {
    getMine.mockResolvedValue(mine({ publication: publication({ status: 'approved' }) }));
    unpublish.mockRejectedValue(http(409, 'ROUTE_INVALID_STATE', { reason: 'hidden' }));
    await openDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Снять с публикации' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Снять с публикации' }));
    expect(await screen.findByText('Маршрут скрыт модератором')).toBeOnTheScreen();
  });

  it('«Отклонён»: причина словами и комментарий; «Опубликовать» снова при canPublish', async () => {
    getMine.mockResolvedValue(
      mine({
        canPublish: true,
        publication: publication({
          status: 'rejected',
          rejection: { reason: 'impassable', comment: 'Мост закрыт' },
        }),
      }),
    );
    await openDetail();
    expect(await screen.findByText('Отклонён')).toBeOnTheScreen();
    expect(screen.getByText('Причина: Непроезжий или неточный')).toBeOnTheScreen();
    expect(screen.getByText('Комментарий модератора: Мост закрыт')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Переименовать' })).toBeOnTheScreen();
  });

  it('«Отклонён» без подач — «использованы все 3 подачи», без «Опубликовать»', async () => {
    getMine.mockResolvedValue(
      mine({
        publication: publication({
          status: 'rejected',
          rejection: { reason: 'other', comment: null },
        }),
      }),
    );
    await openDetail();
    expect(
      await screen.findByText('Подать маршрут снова нельзя: использованы все 3 подачи.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull();
    expect(screen.queryByText(/^Комментарий модератора/)).toBeNull();
  });

  it('«Скрыт модератором»: пояснение без действий публикации; переименовать можно (A1)', async () => {
    getMine.mockResolvedValue(mine({ publication: publication({ status: 'hidden' }) }));
    await openDetail();
    expect(await screen.findByText('Скрыт модератором')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Модератор скрыл маршрут из каталога. Подать его снова нельзя — только удалить.',
      ),
    ).toBeOnTheScreen();
    for (const action of ['Опубликовать', 'Снять с публикации', 'Отозвать заявку']) {
      expect(screen.queryByRole('button', { name: action })).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Переименовать' })).toBeOnTheScreen();
  });

  it('удаление опубликованного — предупреждение «Маршрут исчезнет из каталога»; не опубликованного — нет', async () => {
    getMine.mockResolvedValue(mine({ publication: publication({ status: 'approved' }) }));
    deleteMine.mockResolvedValue(undefined);
    await openDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить' }));
    expect(screen.getByText('Маршрут исчезнет из каталога.')).toBeOnTheScreen();
  });

  it('удаление не опубликованного — без предупреждения о каталоге', async () => {
    getMine.mockResolvedValue(mine({ publication: publication() }));
    await openDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить' }));
    expect(screen.queryByText('Маршрут исчезнет из каталога.')).toBeNull();
  });

  it('переименование: заявку подали на другом устройстве — 409 in_review текстом', async () => {
    getMine.mockResolvedValue(mine());
    renameMine.mockRejectedValue(http(409, 'ROUTE_INVALID_STATE', { reason: 'in_review' }));
    await openDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Переименовать' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Заявка уже на проверке')).toBeOnTheScreen();
  });
});

describe('экран заявки в каталог (routes-06, A2)', () => {
  it('гость по ссылке — гард ведёт на вход, запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    const router = await renderRouter(appRoutes, { initialUrl: `/routes/mine/publish/${ID}` });
    await waitFor(() => expect(router.getPathname()).not.toBe(`/routes/mine/publish/${ID}`));
    expect(getMine).not.toHaveBeenCalled();
  });

  it('форма: предупреждение; город и покрытие обязательны; галочка имени; отправка → назад к карточке «На проверке»', async () => {
    getMine.mockResolvedValue(mine({ canPublish: true }));
    submit.mockResolvedValue(mine({ publication: publication({ showAuthorName: true }) }));
    const router = await open(`/routes/mine/${ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Опубликовать' }));

    expect(await screen.findByText('Линия, старт и финиш станут видны всем.')).toBeOnTheScreen();
    expect(screen.getByText('Город старта')).toBeOnTheScreen();
    const send = screen.getByRole('button', { name: 'Отправить на проверку' });
    expect(send).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Минск' }));
    expect(screen.getByRole('button', { name: 'Отправить на проверку' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Гравий' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Подписать моим именем' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить на проверку' }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(TOKEN, ID, {
        city: 'minsk',
        surfaces: ['gravel'],
        showAuthorName: true,
      }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/mine/${ID}`));
    expect(await screen.findByText('На проверке')).toBeOnTheScreen();
  });

  it('без галочки — showAuthorName: false; отклонённая заявка подставляет прежние город и покрытие', async () => {
    getMine.mockResolvedValue(
      mine({
        canPublish: true,
        publication: publication({
          status: 'rejected',
          city: 'brest',
          surfaces: ['asphalt', 'gravel'],
          rejection: { reason: 'duplicate', comment: null },
        }),
      }),
    );
    submit.mockResolvedValue(mine({ publication: publication() }));
    await openPublish();
    await fireEvent.press(await screen.findByRole('button', { name: 'Отправить на проверку' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(TOKEN, ID, {
        city: 'brest',
        surfaces: ['asphalt', 'gravel'],
        showAuthorName: false,
      }),
    );
  });

  it.each([
    [
      http(409, 'ROUTE_PUBLICATION_LIMIT', { limit: 'pending', max: 3 }),
      'На проверке уже 3 заявки — дождитесь решения модератора',
    ],
    [
      http(409, 'ROUTE_PUBLICATION_LIMIT', { limit: 'route_submissions', max: 3 }),
      'Маршрут подавали уже 3 раза — больше нельзя',
    ],
    [http(409, 'ROUTE_INVALID_STATE', { reason: 'in_review' }), 'Заявка уже на проверке'],
    [
      http(429, 'RATE_LIMITED', { retryAfterSec: 600 }),
      'Слишком много заявок за сутки. Попробуйте завтра.',
    ],
    [
      new ApiNetworkError(new TypeError('offline')),
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    ],
    [http(500, 'INTERNAL'), 'Что-то пошло не так. Попробуйте ещё раз.'],
  ])('отказ %# — баннер с причиной, форма остаётся', async (error, text) => {
    getMine.mockResolvedValue(
      mine({ canPublish: true, publication: publication({ status: 'rejected' }) }),
    );
    submit.mockRejectedValue(error);
    const router = await openPublish();
    await fireEvent.press(await screen.findByRole('button', { name: 'Отправить на проверку' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить на проверку' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/routes/mine/publish/${ID}`);
  });

  it('canPublish false — «нельзя подать» без формы', async () => {
    getMine.mockResolvedValue(mine({ publication: publication() }));
    await openPublish();
    expect(
      await screen.findByText('Этот маршрут сейчас нельзя подать в каталог'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить на проверку' })).toBeNull();
  });

  it('404 и невалидный id — «Маршрут недоступен»', async () => {
    getMine.mockRejectedValue(http(404, 'NOT_FOUND'));
    await openPublish();
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
  });

  it('невалидный id — без запроса', async () => {
    await open('/routes/mine/publish/not-a-uuid');
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(getMine).not.toHaveBeenCalled();
  });
});
