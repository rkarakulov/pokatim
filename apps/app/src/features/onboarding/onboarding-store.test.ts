/// <reference types="jest" />
import type { OnboardingStatus } from '@pokatim/contracts';

import { liveSession, liveSessionB } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { useOnboardingStore } from './onboarding-store';

jest.mock('@/lib/api', () => ({ api: { getOnboardingStatus: jest.fn() } }));

const status = jest.mocked(api.getOnboardingStatus);
const cache = () =>
  jest
    .requireMock<{ __store: Map<string, string> }>('expo-secure-store')
    .__store.get('pokatim.onboarding');

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const signIn = (session = liveSession) =>
  useSessionStore.setState({ status: 'signedIn', session, sessionReceivedAt: null });
const signOut = () => useSessionStore.setState({ status: 'signedOut', session: null });

afterEach(() => jest.clearAllMocks());

describe('стор онбординга: кеш опроса и поздние ответы', () => {
  it('поздний ответ GET после выхода не восстанавливает кеш; следующий аккаунт спрашивает сервер', async () => {
    signIn();
    const late = deferred<OnboardingStatus>();
    status.mockReturnValueOnce(late.promise);
    const hydrating = useOnboardingStore.getState().hydrate();
    // запрос статуса ушёл (кеша нет), ответ ещё не пришёл
    while (status.mock.calls.length === 0) await new Promise((done) => setTimeout(done, 0));

    signOut();
    await useOnboardingStore.getState().reset();
    late.resolve({ surveyCompleted: true });
    await hydrating;

    expect(cache()).toBeUndefined();
    expect(useOnboardingStore.getState().survey).toBe('unknown');

    signIn(liveSessionB);
    status.mockResolvedValueOnce({ surveyCompleted: false });
    await useOnboardingStore.getState().hydrate();
    expect(status).toHaveBeenCalledTimes(2);
    expect(useOnboardingStore.getState().survey).toBe('required');
  });

  it('completeSurvey после смены аккаунта — ни кеша, ни «пройден» для нового владельца', async () => {
    signIn(liveSessionB);
    await useOnboardingStore.getState().completeSurvey(
      // владелец ответа — аккаунт A (запрос ушёл до смены сессии)
      'not-the-current-owner',
    );
    expect(cache()).toBeUndefined();
    expect(useOnboardingStore.getState().survey).toBe('unknown');
  });

  it('completeDevicesStep после смены аккаунта — ни кеша, ни «пройден» для нового владельца', async () => {
    signIn(liveSessionB);
    await useOnboardingStore.getState().completeDevicesStep('not-the-current-owner');
    expect(cache()).toBeUndefined();
    expect(useOnboardingStore.getState().devices).toBe('unknown');
  });

  it('статус без поля шага (старый API) — шаг пропущен и не кешируется: следующий запуск спросит сервер', async () => {
    signIn();
    status.mockResolvedValueOnce({ surveyCompleted: true });
    await useOnboardingStore.getState().hydrate();

    expect(useOnboardingStore.getState().devices).toBe('done');
    expect(JSON.parse(cache() ?? '{}')).not.toHaveProperty('devicesStepCompleted');
  });
});
