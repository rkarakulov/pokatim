import { size } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, Skeleton, SkeletonGroup, SkeletonText } from '@rkarakulov/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { DocumentTitle } from '@/components/document-title';
import { ShellSkeleton } from '@/components/shell-skeleton';
import { AuthActions, AuthScreen, AuthStack, AuthText } from '@/features/auth/auth-screen';
import { isSessionPending, isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { isConnectInFlight, takeConnectOrigin } from '@/features/devices/connect-flow';
import { deviceActionErrorMessage } from '@/features/devices/error-messages';
import { useCompleteDevice } from '@/features/devices/queries';
import {
  CONNECT_ORIGIN_PATHS,
  parseDeviceReturn,
  type ConnectOrigin,
} from '@/features/devices/return-params';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';

const DOCUMENT_TITLE = `${t('devices.return.title')} — ${t('app.name')}`;

function CompletingSkeleton() {
  return (
    <SkeletonGroup>
      <AuthStack>
        <SkeletonText lines={2} />
        <Skeleton height={size.buttonHeight} />
      </AuthStack>
    </SkeletonGroup>
  );
}

/**
 * Возврат из авторизации устройства `devices/return?provider&result&t` (вне гардов: и из шага онбординга, и из
 * «Устройств»; web — новой загрузкой страницы, native — ссылкой `pokatim://`). `result=pending` с тикетом —
 * `complete` под входом, затем назад, откуда пришли (web — `sessionStorage` вкладки, по умолчанию «Устройства»);
 * `result=error` и мусорный тикет — «Не удалось подключить. Повторите.» без запроса. Native во время сессии
 * авторизации (Android доставляет ссылку и в Router) — завершает экран, начавший подключение, здесь только уходим.
 * Ответы web-сервера для этого пути — `Referrer-Policy: no-referrer` (в URL тикет).
 */
export default function DeviceReturnScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [result] = useState(() => parseDeviceReturn(params));
  const status = useSessionStore((state) => state.status);
  const signedIn = useSessionStore((state) => isSignedIn(state));
  const failure = useShellFailure();
  const complete = useCompleteDevice();
  const origin = useRef<ConnectOrigin>('settings');
  const started = useRef(false);

  // откуда пришли — браузерное хранилище: читается после монтирования (SSR), один раз
  useEffect(() => {
    origin.current = takeConnectOrigin() ?? 'settings';
  }, []);

  const leave = () => router.replace(CONNECT_ORIGIN_PATHS[origin.current]);

  useEffect(() => {
    if (result.kind !== 'pending' || !signedIn || started.current) return;
    started.current = true;
    if (isConnectInFlight()) {
      if (router.canGoBack()) router.back();
      return;
    }
    complete.mutate(
      { provider: result.provider, ticket: result.ticket },
      { onSuccess: () => router.replace(CONNECT_ORIGIN_PATHS[origin.current]) },
    );
  }, [complete, result, router, signedIn]);

  if (result.kind === 'pending' && isSessionPending(status)) {
    return <ShellSkeleton failure={failure} />;
  }

  const body = () => {
    if (result.kind === 'error') {
      return (
        <>
          <AuthText>{t('devices.connectFailed')}</AuthText>
          <AuthActions>
            <Button label={t('devices.return.back')} onPress={leave} />
          </AuthActions>
        </>
      );
    }
    if (!signedIn) {
      return (
        <>
          <AuthText>{t('devices.return.signIn')}</AuthText>
          <AuthActions>
            <Button
              label={t('devices.return.signInAction')}
              onPress={() => router.replace('/sign-in')}
            />
          </AuthActions>
        </>
      );
    }
    if (complete.isError) {
      return (
        <AuthActions>
          <Banner tone="error" message={deviceActionErrorMessage(complete.error)} />
          <Button label={t('devices.return.back')} onPress={leave} />
        </AuthActions>
      );
    }
    return <CompletingSkeleton />;
  };

  return (
    <AuthScreen kicker={t('devices.title')} title={t('devices.return.title')}>
      <DocumentTitle title={DOCUMENT_TITLE} />
      {body()}
    </AuthScreen>
  );
}
