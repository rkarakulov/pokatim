/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { RIDE_PHOTO_MAX_BYTES, type RideDetail, type RideView } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { pickImage } from '@/features/media/pick-image';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { prepareStory, shareStory } from '@/lib/share-story';

import RideRoute from '../app/rides/[id]';
import RideInviteRoute from '../app/rides/invite/[id]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/features/media/pick-image', () => ({ pickImage: jest.fn() }));
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn(() => null) }));
jest.mock('@/lib/share-story', () => ({
  prepareStory: jest.fn((url: string) => Promise.resolve({ url, uri: 'file:///cache/invite.png' })),
  storyShareMode: jest.fn(() => 'share'),
  storyPreviewSource: jest.fn((file: { uri: string }) => ({ uri: file.uri, release: jest.fn() })),
  shareStory: jest.fn(() => Promise.resolve('shared')),
}));

const getRide = jest.mocked(api.getRide);
const getRideForViewer = jest.mocked(api.getRideForViewer);
const getRideInviteCard = jest.mocked(api.getRideInviteCard);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000011';
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const INVITE = 'Карточка-приглашение';

const detail: RideDetail = {
  id: ID,
  title: 'Кофе-райд на Минское море',
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 3,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  route: null,
  start: null,
  photo: null,
  description: null,
};
const view = (
  ride: Partial<RideDetail> = {},
  viewer: Partial<RideView['viewer']> = {},
): RideView => ({
  ride: { ...detail, ...ride },
  viewer: {
    role: 'none',
    canJoin: true,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
    ...viewer,
  },
});
const organizer = { role: 'organizer', canJoin: false, canManage: true } as const;
const PHOTO = { id: 'PhOtOiDpHoToIdPhOtOiD_' };

const routes = {
  ...tabRoutes,
  'rides/[id]': RideRoute,
  'rides/invite/[id]': RideInviteRoute,
  'rides/report/[id]': () => <Text>Жалоба</Text>,
};
const open = (url: string) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getRide.mockResolvedValue(detail);
  getRideForViewer.mockResolvedValue(view());
  jest
    .mocked(api.storyCardImageUrl)
    .mockImplementation((token) => `https://api.test/v1/story-cards/${token}.png`);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('вход с карточки райда', () => {
  it('будущий райд, вошедший, без web-origin — «Поделиться» ведёт на экран приглашения', async () => {
    getRideInviteCard.mockResolvedValue({ status: 'pending' });
    const router = await open(`/rides/${ID}`);
    expect(screen.queryByRole('button', { name: INVITE })).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(router.getPathname()).toBe(`/rides/invite/${ID}`);
  });

  it('прошедший райд — ни «Поделиться», ни приглашения', async () => {
    getRide.mockResolvedValue({ ...detail, phase: 'past' });
    getRideForViewer.mockResolvedValue(view({ phase: 'past' }));
    await open(`/rides/${ID}`);
    expect(await screen.findAllByText('Кофе-райд на Минское море')).not.toHaveLength(0);
    await waitFor(() => expect(getRideForViewer).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: INVITE })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
  });
});

describe('экран приглашения', () => {
  it('pending → ready: превью и «Поделиться» отдают локальный PNG', async () => {
    getRideInviteCard
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/rides/invite/${ID}`);
    expect(getRideInviteCard).toHaveBeenCalledWith(expect.any(String), ID, { template: 'line' });
    const preview = await screen.findByTestId('story-preview', {}, { timeout: 5000 });
    expect(preview.props.accessibilityLabel).toBe(
      'Карточка-приглашение: Кофе-райд на Минское море',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Поделиться' })).not.toBeDisabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(shareStory).toHaveBeenCalledWith(
      { url: `https://api.test/v1/story-cards/${TOKEN}.png`, uri: 'file:///cache/invite.png' },
      INVITE,
    );
  });

  it('шаблон «Ночь» — свой запрос', async () => {
    getRideInviteCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/rides/invite/${ID}`);
    await screen.findByTestId('story-preview');
    await fireEvent.press(screen.getByText('Ночь'));
    await waitFor(() =>
      expect(getRideInviteCard).toHaveBeenCalledWith(expect.any(String), ID, {
        template: 'night',
      }),
    );
  });

  it.each([
    [409, 'STORY_CARD_UNAVAILABLE'],
    [404, 'NOT_FOUND'],
  ])('%i %s — «Приглашение недоступно» и «К райду»', async (status, code) => {
    getRideInviteCard.mockRejectedValue(new ApiHttpError(status, { code, message: 'x' }));
    const router = await open(`/rides/invite/${ID}`);
    expect(await screen.findByText('Приглашение недоступно')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К райду' }));
    expect(router.getPathname()).toBe(`/rides/${ID}`);
  });

  it('кривой id — без запроса, «Приглашение недоступно»', async () => {
    await open('/rides/invite/not-a-uuid');
    expect(await screen.findByText('Приглашение недоступно')).toBeOnTheScreen();
    expect(getRideInviteCard).not.toHaveBeenCalled();
  });
});

describe('фото организатора на экране приглашения (ride-photo P3, AC7)', () => {
  const pick = jest.mocked(pickImage);
  const upload = jest.mocked(api.uploadRidePhoto);
  const remove = jest.mocked(api.deleteRidePhoto);
  const blob = new Blob(['jpeg']);

  beforeEach(() => {
    getRideInviteCard.mockResolvedValue({ status: 'ready', token: TOKEN });
  });

  it('не организатору — блока «Своё фото» нет', async () => {
    await open(`/rides/invite/${ID}`);
    await screen.findByTestId('story-preview');
    await waitFor(() => expect(getRideForViewer).toHaveBeenCalled());
    expect(screen.queryByText('Своё фото')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить своё фото' })).toBeNull();
  });

  it('организатор без права правки (райд скрыт или начался) — блока нет', async () => {
    getRideForViewer.mockResolvedValue(view({}, { ...organizer, canManage: false }));
    await open(`/rides/invite/${ID}`);
    await screen.findByTestId('story-preview');
    await waitFor(() => expect(getRideForViewer).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Добавить своё фото' })).toBeNull();
  });

  it('«Добавить своё фото»: выбор без обрезки, загрузка байтами; после — «Заменить фото», «Удалить фото» и новая карточка', async () => {
    getRideForViewer.mockResolvedValue(view({}, organizer));
    pick.mockResolvedValue({ body: blob });
    upload.mockResolvedValue(view({ photo: PHOTO }, organizer));
    await open(`/rides/invite/${ID}`);
    const add = await screen.findByRole('button', { name: 'Добавить своё фото' });
    expect(screen.queryByRole('button', { name: 'Удалить фото' })).toBeNull();
    const cardCalls = getRideInviteCard.mock.calls.length;
    getRideForViewer.mockResolvedValue(view({ photo: PHOTO }, organizer));

    await fireEvent.press(add);

    expect(pick).toHaveBeenCalledWith({ maxBytes: RIDE_PHOTO_MAX_BYTES, square: false });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(String), ID, blob));
    expect(await screen.findByRole('button', { name: 'Заменить фото' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Удалить фото' })).toBeOnTheScreen();
    // статус карточки перезапрошен (инвалидация `['rides']`): `night` с фото — новый токен сервера
    await waitFor(() => expect(getRideInviteCard.mock.calls.length).toBeGreaterThan(cardCalls));
  });

  it('/me не загрузился — «Не удалось загрузить» с повтором в месте блока; повтор — блок организатора', async () => {
    getRideForViewer.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await open(`/rides/invite/${ID}`);
    await screen.findByTestId('story-preview');
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Добавить своё фото' })).toBeNull();

    getRideForViewer.mockResolvedValue(view({}, organizer));
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Добавить своё фото' })).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('/me 404 (скрытый райд) — без блока и без ошибки', async () => {
    getRideForViewer.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await open(`/rides/invite/${ID}`);
    await screen.findByTestId('story-preview');
    await waitFor(() => expect(getRideForViewer).toHaveBeenCalled());
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить своё фото' })).toBeNull();
  });

  it('ошибка обновления /me после загрузки — блок остаётся (с фото), баннер с повтором', async () => {
    getRideForViewer.mockResolvedValue(view({}, organizer));
    pick.mockResolvedValue({ body: blob });
    upload.mockResolvedValue(view({ photo: PHOTO }, organizer));
    await open(`/rides/invite/${ID}`);
    const add = await screen.findByRole('button', { name: 'Добавить своё фото' });
    // инвалидация `['rides']` после загрузки перезапрашивает `me` — и он падает
    getRideForViewer.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));

    await fireEvent.press(add);

    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Заменить фото' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Удалить фото' })).toBeOnTheScreen();
  });

  it('первый запрос статуса в полёте при смене фото — отменён и повторён: карточка с новым фото, старый токен не побеждает', async () => {
    getRideForViewer.mockResolvedValue(view({}, organizer));
    pick.mockResolvedValue({ body: blob });
    upload.mockResolvedValue(view({ photo: PHOTO }, organizer));
    let resolveOld!: (value: { status: 'ready'; token: string }) => void;
    const NEW_TOKEN = 'NeWtOkEnNeWtOkEnNeW_-x';
    getRideInviteCard.mockReset();
    getRideInviteCard
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValue({ status: 'ready', token: NEW_TOKEN });
    await open(`/rides/invite/${ID}`);
    await waitFor(() => expect(getRideInviteCard).toHaveBeenCalledTimes(1));

    await fireEvent.press(await screen.findByRole('button', { name: 'Добавить своё фото' }));
    await waitFor(() => expect(getRideInviteCard).toHaveBeenCalledTimes(2));
    resolveOld({ status: 'ready', token: TOKEN });

    await screen.findByTestId('story-preview');
    await waitFor(() =>
      expect(prepareStory).toHaveBeenCalledWith(`https://api.test/v1/story-cards/${NEW_TOKEN}.png`),
    );
    expect(prepareStory).not.toHaveBeenCalledWith(`https://api.test/v1/story-cards/${TOKEN}.png`);
  });

  it('отмена выбора — без запроса и без ошибки', async () => {
    getRideForViewer.mockResolvedValue(view({}, organizer));
    pick.mockResolvedValue(null);
    await open(`/rides/invite/${ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Добавить своё фото' }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [
      new ApiHttpError(422, {
        code: 'IMAGE_INVALID',
        message: 'x',
        details: { reason: 'too_small' },
      }),
      'Фото слишком маленькое или слишком вытянутое — выберите другое',
    ],
    [
      new ApiHttpError(409, { code: 'RIDE_INVALID_STATE', message: 'x' }),
      'Фото можно добавить только к будущему райду',
    ],
  ])('отказ загрузки — понятный текст баннером (%#)', async (error, text) => {
    getRideForViewer.mockResolvedValue(view({}, organizer));
    pick.mockResolvedValue({ body: blob });
    upload.mockRejectedValue(error);
    await open(`/rides/invite/${ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Добавить своё фото' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Добавить своё фото' })).not.toBeDisabled();
  });

  it('«Удалить фото»: кнопки заняты на время запроса; после — снова «Добавить своё фото»', async () => {
    getRideForViewer.mockResolvedValue(view({ photo: PHOTO }, organizer));
    let resolve!: (value: RideView) => void;
    remove.mockReturnValue(new Promise((r) => (resolve = r)));
    await open(`/rides/invite/${ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить фото' }));

    expect(remove).toHaveBeenCalledWith(expect.any(String), ID);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Удалить фото' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Заменить фото' })).toBeDisabled();

    getRideForViewer.mockResolvedValue(view({}, organizer));
    resolve(view({}, organizer));
    expect(await screen.findByRole('button', { name: 'Добавить своё фото' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Удалить фото' })).toBeNull();
  });
});
