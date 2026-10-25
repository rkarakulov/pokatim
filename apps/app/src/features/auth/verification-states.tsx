import { isNetworkError } from '@pokatim/api-client';
import { t } from '@pokatim/i18n';
import { Banner, Button, keepTogether, TextAction } from '@rkarakulov/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { isRegistrationRejected } from './queries';

import { AuthActions, AuthText, AuthTitle } from './auth-screen';
import { useRegistrationStore } from './registration-store';

// Содержимое экранов (заголовок + текст + действия) — внутри AuthScreen у «Подтвердите e-mail» и у ссылки.

/** «E-mail подтверждён» на устройстве регистрации: держится ~1 с, затем вход без пароля и опрос (слайс 4, Q9). */
export function VerifiedSigningIn({ email }: { email: string }) {
  return (
    <>
      <AuthTitle>{t('auth.verified.title')}</AuthTitle>
      <AuthText>{t('auth.verified.signingIn', { email: keepTogether(email) })}</AuthText>
      <AuthText tone="secondary">{t('auth.verified.next')}</AuthText>
    </>
  );
}

/** Для экрана входа: e-mail — через память (черновик), не через URL (история браузера, логи web-сервера). */
export function prefillSignInEmail(email: string) {
  const store = useRegistrationStore.getState();
  store.saveDraft({ ...store.draft, email });
}

/** Подтверждено, но токена регистрации здесь нет (другое устройство) — вход по паролю здесь же. */
export function VerifiedElsewhere({ email }: { email: string }) {
  const router = useRouter();
  const signIn = () => {
    prefillSignInEmail(email);
    router.replace('/sign-in');
  };
  return (
    <>
      <AuthTitle>{t('auth.verified.title')}</AuthTitle>
      <AuthText>{t('auth.verified.otherDevice', { email: keepTogether(email) })}</AuthText>
      <AuthActions>
        <Button label={t('auth.signIn.action')} onPress={signIn} />
      </AuthActions>
    </>
  );
}

/** Регистрация этого устройства и не истёк ли её токен по оценке клиента (`expiresAt`). */
function snapshotRegistration() {
  const { pending } = useRegistrationStore.getState();
  return { pending, verified: pending !== null && pending.expiresAt > Date.now() };
}

/**
 * Токен регистрации отклонён (401). Сервер не различает «обменян» и «истёк» (без оракула, R7), а клиент знает свою
 * оценку срока: не истёк — значит, обменян (ответ опроса потерялся), адрес подтверждён → «Войдите с паролем»;
 * истёк — «Регистрация устарела»: вход или регистрация заново.
 */
export function SignInRequired() {
  const router = useRouter();
  // снимок на момент отказа: дальше регистрация очищается
  const [{ pending, verified }] = useState(snapshotRegistration);

  const leave = (path: '/sign-in' | '/register') => {
    if (pending) prefillSignInEmail(pending.email);
    router.replace(path);
    void useRegistrationStore.getState().clear();
  };

  return (
    <>
      <AuthTitle>
        {t(verified ? 'auth.signInRequired.title' : 'auth.signInRequired.expiredTitle')}
      </AuthTitle>
      <AuthText>
        {t(verified ? 'auth.signInRequired.verifiedMessage' : 'auth.signInRequired.expiredMessage')}
      </AuthText>
      <AuthActions>
        <Button label={t('auth.signIn.action')} onPress={() => leave('/sign-in')} />
        {verified ? null : (
          <TextAction
            label={t('auth.signInRequired.toRegister')}
            onPress={() => leave('/register')}
          />
        )}
      </AuthActions>
    </>
  );
}

type PollState = Pick<UseQueryResult<unknown>, 'error' | 'isError' | 'fetchStatus' | 'refetch'>;

/**
 * Проблема опроса подтверждения (AGENTS.md §4.12): без сети — «Нет соединения», ответ сервера —
 * «Не удалось загрузить»; всегда с повтором, контент экрана не прячем. 401 обрабатывает экран («Войдите»).
 */
export function PollProblem({ poll }: { poll: PollState }) {
  const offline = poll.fetchStatus === 'paused';
  if (!offline && (!poll.isError || isRegistrationRejected(poll.error))) return null;
  const server = !offline && !isNetworkError(poll.error);

  return (
    <>
      <Banner
        tone="warning"
        title={t(server ? 'state.failedTitle' : 'state.errorTitle')}
        message={t(server ? 'state.failedMessage' : 'state.errorMessage')}
      />
      <TextAction label={t('state.retry')} onPress={() => void poll.refetch()} />
    </>
  );
}
