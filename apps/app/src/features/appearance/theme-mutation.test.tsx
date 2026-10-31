/// <reference types="jest" />
import type { AppThemeId, ProfileView } from '@pokatim/contracts';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { liveSession, signInForTest } from '@/__tests__/auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from '@/__tests__/query-wrapper';
import { useSessionStore } from '@/features/auth/session-store';
import { PROFILE_QUERY_KEY } from '@/features/home/queries';
import { api } from '@/lib/api';

import { useSetTheme } from './theme-mutation';

jest.mock('@/lib/api');

const setProfileTheme = jest.mocked(api.setProfileTheme);

const profile = (themeId: AppThemeId): ProfileView => ({
  rideReasons: ['races'],
  publicName: 'Иван',
  showNameInResults: true,
  club: null,
  avatar: null,
  publicId: null,
  themeId,
  avatarUploadBlockedUntil: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
});
afterEach(() => jest.clearAllMocks());

async function setup() {
  const client = createTestQueryClient();
  client.setQueryData(PROFILE_QUERY_KEY, profile('classic'));
  const hook = await renderHook(() => useSetTheme(), { wrapper: createQueryWrapper(client) });
  const themeOf = () => client.getQueryData<ProfileView>(PROFILE_QUERY_KEY)?.themeId;
  return { client, hook, themeOf };
}

describe('useSetTheme (user-theme A10)', () => {
  it('оптимистично меняет тему в кэше профиля до ответа; PUT с выбранной темой', async () => {
    const response = deferred<ProfileView>();
    setProfileTheme.mockReturnValue(response.promise);
    const { hook, themeOf, client } = await setup();

    await act(async () => hook.result.current.mutate('atlas'));
    expect(themeOf()).toBe('atlas');
    expect(setProfileTheme).toHaveBeenCalledWith(liveSession.accessToken, { themeId: 'atlas' });
    // прочие поля профиля сохраняются
    expect(client.getQueryData<ProfileView>(PROFILE_QUERY_KEY)?.publicName).toBe('Иван');

    await act(async () => response.resolve(profile('atlas')));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  });

  it('успех — ответ сервера в кэше профиля', async () => {
    setProfileTheme.mockResolvedValue({ ...profile('atlas'), publicName: 'Сервер' });
    const { hook, client } = await setup();
    await act(async () => hook.result.current.mutate('atlas'));
    await waitFor(() =>
      expect(client.getQueryData<ProfileView>(PROFILE_QUERY_KEY)?.publicName).toBe('Сервер'),
    );
  });

  it('успех — статусы карточек для сторис инвалидированы (сервер рисует в теме профиля)', async () => {
    setProfileTheme.mockResolvedValue(profile('atlas'));
    const { hook, client } = await setup();
    const cardKey = ['rides', 'invite', 'id', 'line', 'atlas'];
    // запрос статуса карточки — с меткой `useCardStatus`
    client.getQueryCache().build(client, { queryKey: cardKey, meta: { cardStatus: true } });
    client.setQueryData(cardKey, { status: 'ready', token: 'old' });
    const otherKey = ['rides', 'detail', 'id'];
    client.setQueryData(otherKey, {});

    await act(async () => hook.result.current.mutate('atlas'));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(client.getQueryState(cardKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it('ответ после выхода (кэш очищен) — профиль прошлого аккаунта в кэш не возвращается', async () => {
    const response = deferred<ProfileView>();
    setProfileTheme.mockReturnValue(response.promise);
    const { hook, client } = await setup();
    await act(async () => hook.result.current.mutate('atlas'));

    await act(async () => client.clear());
    await act(async () => response.resolve(profile('atlas')));
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
    expect(client.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
  });

  it('ошибка — откат к прежней теме, мутация в ошибке (баннер экрана)', async () => {
    setProfileTheme.mockRejectedValue(new Error('network'));
    const { hook, themeOf } = await setup();
    await act(async () => hook.result.current.mutate('journal'));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(themeOf()).toBe('classic');
  });

  it('две быстрые мутации: ранняя падает позже поздней оптимистичной — итог последней (scope)', async () => {
    const first = deferred<ProfileView>();
    const second = deferred<ProfileView>();
    setProfileTheme.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook, themeOf } = await setup();

    await act(async () => hook.result.current.mutate('atlas'));
    await act(async () => hook.result.current.mutate('chrono'));
    // мутации одного scope идут по очереди: вторая ещё не отправлена
    expect(setProfileTheme).toHaveBeenCalledTimes(1);

    await act(async () => first.reject(new Error('network')));
    await waitFor(() => expect(setProfileTheme).toHaveBeenCalledTimes(2));
    expect(themeOf()).toBe('chrono');
    await act(async () => second.resolve(profile('chrono')));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(themeOf()).toBe('chrono');
  });

  it('ранняя успешна, поздняя падает — откат к подтверждённой сервером, без промежуточного мигания', async () => {
    const first = deferred<ProfileView>();
    const second = deferred<ProfileView>();
    setProfileTheme.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook, themeOf } = await setup();

    await act(async () => hook.result.current.mutate('atlas'));
    await act(async () => hook.result.current.mutate('chrono'));
    await act(async () => first.resolve(profile('atlas')));
    // ответ ранней не перекрашивает назад, пока поздняя в полёте
    await waitFor(() => expect(setProfileTheme).toHaveBeenCalledTimes(2));
    expect(themeOf()).toBe('chrono');

    await act(async () => second.reject(new Error('network')));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(themeOf()).toBe('atlas');
  });
});
