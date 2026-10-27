import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { DeleteAccountForm } from '@/features/account/delete-account-form';
import { rememberReturnPath } from '@/features/auth/return-path';
import { isSessionPending, isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';

const PATH = '/settings/account/delete';

/** Гость: путь — в allowlist возврата, затем «Вход»; после входа корневой layout вернёт сюда (A12). */
function ToSignIn() {
  const router = useRouter();
  useEffect(() => {
    rememberReturnPath(PATH);
    router.replace('/sign-in');
  }, [router]);
  return <ShellSkeleton />;
}

/**
 * «Удаление аккаунта» (`/settings/account/delete`, A12 — адрес для Google Play). Вне `Stack.Protected`: экран решает
 * сам. Сессия неизвестна (SSR, запуск) — скелетон оболочки или ошибка с повтором; гость — «Вход» и возврат сюда;
 * только что удалён (отметка выхода) — «Регистрация» с «Аккаунт удалён»; вошёл — форма (онбординг не обязателен).
 * Не публичный: без `generateMetadata`/`loader`.
 */
export default function DeleteAccountScreen() {
  const status = useSessionStore((state) => state.status);
  const signedIn = useSessionStore((state) => isSignedIn(state));
  const notice = useSessionStore((state) => state.notice);
  const failure = useShellFailure();

  if (isSessionPending(status)) return <ShellSkeleton failure={failure} />;
  if (signedIn) return <DeleteAccountForm />;
  if (notice === 'accountDeleted') return <Redirect href="/register" />;
  return <ToSignIn />;
}
