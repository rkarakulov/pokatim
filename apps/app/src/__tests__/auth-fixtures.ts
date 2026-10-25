/// <reference types="jest" />
import type { RegisterResponse, Session } from '@pokatim/contracts';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';

import { fakeAccessToken, SID_B, USER_A, USER_B } from './jwt';

/** Фикстуры для тестов auth. Токены — 43 символа base64url, как в контракте. */
export const NOW = new Date('2026-10-22T10:00:00Z');

export const REGISTRATION_TOKEN = 'r'.repeat(43);
export const LINK_TOKEN = 'L'.repeat(43);
export const EMAIL = 'ivan.k@mail.by';

export const registerResponse: RegisterResponse = {
  registrationToken: REGISTRATION_TOKEN,
  email: EMAIL,
  resendAvailableInSec: 60,
};

export const session: Session = {
  // access — JWT аккаунта USER_A (приложение читает из payload только чей он и срок жизни)
  accessToken: fakeAccessToken(),
  accessTokenExpiresAt: '2026-10-22T10:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-11-21T10:00:00.000Z',
};

/** Сессия с живым access (без обновления перед авторизованным запросом). */
export const liveSession: Session = {
  ...session,
  accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
};

/** Живая сессия другого аккаунта (USER_B) — вход другим пользователем на том же устройстве. */
export const liveSessionB: Session = {
  ...liveSession,
  accessToken: fakeAccessToken({ sub: USER_B, sid: SID_B }),
  refreshToken: 'refresh-token-b',
};

const secureStore = () =>
  jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;

/** Сессия, сохранённая прошлым запуском. */
export function storeSession(value: Session = session) {
  secureStore().set('pokatim.session', JSON.stringify(value));
}

/** Вошедший пользователь без корневого layout: вкладки рендерят контент только при известной сессии и пройденном онбординге. */
export const signInForTest = () => {
  useSessionStore.setState({ status: 'signedIn', session });
  useOnboardingStore.setState({ survey: 'completed', location: 'done' });
};

/** Опрос аккаунта `userId` уже пройден (кеш устройства, привязан к владельцу сессии): сервер не спрашивается. */
export function storeSurveyCompleted(userId = USER_A) {
  secureStore().set('pokatim.onboarding', JSON.stringify({ surveyCompleted: true, userId }));
}

/** Регистрация, начатая прошлым запуском (токен жив). */
export function storePendingRegistration(now = Date.now(), resendInSec = 60) {
  secureStore().set(
    'pokatim.registration',
    JSON.stringify({
      registrationToken: REGISTRATION_TOKEN,
      email: EMAIL,
      resendAvailableAt: now + resendInSec * 1000,
      expiresAt: now + 24 * 3600_000,
    }),
  );
}

export const storedValue = (
  key: 'pokatim.session' | 'pokatim.registration' | 'pokatim.onboarding',
) => secureStore().get(key);
