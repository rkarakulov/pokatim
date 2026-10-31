import { t } from '@pokatim/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';
import { useEffect } from 'react';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { useSessionStore } from '@/features/auth/session-store';
import { rememberInvite } from '@/features/invites/invite-storage';
import { publicPageMetadata } from '@/lib/page-metadata';

/** Мета без кода и `noindex`: HTML одинаков для любого кода (как `/tickets/<код>`). */
export const generateMetadata: GenerateMetadataFunction = () => ({
  ...publicPageMetadata({ title: t('app.name'), description: t('app.tagline') }),
  robots: 'noindex',
});

/**
 * Короткая ссылка приглашения с карточки для сторис (`/i/<код>`, P6, K9): код сохраняется (вошедшему — нет, RC-P6-7)
 * и ведёт на главную. Пока — скелетон оболочки.
 */
export default function InviteRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  useEffect(() => {
    const done = () => router.replace('/');
    if (status === 'signedIn' || !code) {
      done();
      return;
    }
    void rememberInvite(code, Date.now()).finally(done);
  }, [code, status, router]);
  return <ShellSkeleton />;
}
