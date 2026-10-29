import { t } from '@pokatim/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';
import { useEffect } from 'react';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { rememberReturnPath } from '@/features/auth/return-path';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';
import { canonicalTicketCode } from '@/features/tickets/ticket-format';
import { TicketScreen } from '@/features/tickets/ticket-screen';
import { publicPageMetadata } from '@/lib/page-metadata';

/**
 * Мета без кода, события и ПДн и `noindex` (§5.3): HTML страницы одинаков для любого кода — оболочку можно кешировать
 * service worker для офлайн-старта PWA (`scripts/service-worker.ts`). Без `og:url` и `loader`.
 */
export const generateMetadata: GenerateMetadataFunction = () => ({
  ...publicPageMetadata({ title: t('tickets.title'), description: t('app.tagline') }),
  robots: 'noindex',
});

/** Гость: путь билета — в allowlist возврата, затем «Вход»; после входа корневой layout вернёт сюда (T2). */
function ToSignIn({ code }: { code: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (code) rememberReturnPath(`/tickets/${code}`);
    router.replace('/sign-in');
  }, [code, router]);
  return <ShellSkeleton />;
}

/**
 * Билет (`/tickets/<код>`, ссылка из письма, T2, RC-B1). Вне `Stack.Protected`: гард `redirectTo` потерял бы адрес
 * возврата — экран решает сам (образец — `settings/account/delete`). Сессия неизвестна (SSR, запуск) — скелетон
 * оболочки; не проверена (web: сеть, 429) — офлайн-копия или ошибка с повтором (RC-B4); гость — «Вход» и возврат
 * сюда; вошёл — билет (онбординг не обязателен: свой билет из письма).
 */
export default function TicketRoute() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = canonicalTicketCode(raw);
  const status = useSessionStore((state) => state.status);
  const signedIn = useSessionStore((state) => isSignedIn(state));
  const failure = useShellFailure();

  if (status === 'unknown') return <ShellSkeleton />;
  if (status === 'unavailable') return <TicketScreen code={code} offlineOnly failure={failure} />;
  if (signedIn) return <TicketScreen code={code} />;
  return <ToSignIn code={code} />;
}
