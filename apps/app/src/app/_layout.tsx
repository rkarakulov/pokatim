// дизайн-система (бренд, шрифты, i18n pokatim) — до любого модуля, который рендерит компоненты базы
import '@/theme/design-system';
import { useTheme } from '@rkarakulov/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { useRegistrationStore } from '@/features/auth/registration-store';
import { isSessionPending, isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { onboardingStep, useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { connectFocusManager } from '@/lib/focus-manager';
import { connectOnlineManager } from '@/lib/online-manager';
import { createQueryClient } from '@/lib/query-client';
import { fontAssets } from '@/theme/fonts';

// нативный splash держим, пока не загружены шрифты и не прочитаны сессия и регистрация — без мигания экраном
// входа; на web splash нет, а дерево рендерится сразу (SSR): гарды ниже допускают «сессия ещё неизвестна»
void SplashScreen.preventAutoHideAsync();
connectOnlineManager();
// возврат приложения из фона (native) / фокус вкладки (web) — перезапрос устаревших данных (R7 блока 02)
connectFocusManager();

export default function RootLayout() {
  const theme = useTheme();
  const [queryClient] = useState(createQueryClient);
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const sessionStatus = useSessionStore((state) => state.status);
  const signedIn = useSessionStore((state) => isSignedIn(state));
  // на устройстве уже входили (выход, отзыв сессии сервером) — без сессии ведём на «Вход», а не «Регистрацию»
  const returning = useSessionStore((state) => state.returning);
  const registrationHydrated = useRegistrationStore((state) => state.hydrated);
  const fontsReady = fontsLoaded || fontError !== null;
  const hydrated = sessionStatus !== 'unknown' && registrationHydrated;
  const step = useOnboardingStore(onboardingStep);
  const surveyState = useOnboardingStore((state) => state.survey);

  useEffect(() => {
    void useSessionStore.getState().hydrate();
    void useRegistrationStore.getState().hydrate();
  }, []);

  // онбординг выясняется после входа (опрос — кеш или сервер, геопозиция — устройство); повтор после ошибки —
  // с вкладок (`hydrate` из скелетона)
  useEffect(() => {
    if (signedIn && surveyState === 'unknown') void useOnboardingStore.getState().hydrate();
  }, [signedIn, surveyState]);

  // выход из аккаунта (явный, отзыв сессии сервером, refresh 401): кеш запросов и онбординг прежнего аккаунта
  // стираются — следующий вход спросит сервер о своём опросе. Запуск без сессии (`unknown` → `signedOut`) — не выход
  useEffect(
    () =>
      useSessionStore.subscribe((state, previous) => {
        if (state.status !== 'signedOut' || previous.status !== 'signedIn') return;
        queryClient.clear();
        void useOnboardingStore.getState().reset();
      }),
    [queryClient],
  );

  useEffect(() => {
    // без шрифтов работаем на системных, но не молча
    if (fontError) console.warn(`Шрифты не загрузились: ${fontError.message}`);
  }, [fontError]);

  useEffect(() => {
    if (fontsReady && hydrated) void SplashScreen.hideAsync();
  }, [fontsReady, hydrated]);

  // корень ждёт только шрифты (как шаблон): ожидание сессии здесь дало бы пустой HTML при SSR (сервер эффекты
  // не выполняет). Пока сессия неизвестна, открыты обе группы: вкладки рисуют скелетон оболочки, регистрация —
  // форму; после гидрации гард переводит куда нужно
  if (!fontsReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.surface.default },
        }}
      >
        {/* вкладки: сессия или онбординг ещё неизвестны (скелетон, повтор) или онбординг пройден */}
        <Stack.Protected
          guard={
            isSessionPending(sessionStatus) || (signedIn && (step === 'unknown' || step === 'done'))
          }
          redirectTo={
            signedIn
              ? step === 'location'
                ? '/location'
                : '/survey'
              : returning
                ? '/sign-in'
                : '/register'
          }
        >
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        {/* шаги онбординга после входа: опрос → геопозиция → Главная; пока сессия или шаг неизвестны — скелетон
            (SSR отдаёт HTML оболочки, а не пустую страницу редиректа) */}
        <Stack.Protected
          guard={isSessionPending(sessionStatus) || (signedIn && step !== 'done')}
          redirectTo="/"
        >
          <Stack.Screen name="(setup)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        {/* публичные экраны вне гардов: ссылка из письма — и до входа, и на другом устройстве */}
        <Stack.Screen name="auth/verify/[token]" />
        <Stack.Screen name="auth/reset/[token]" />
        <Stack.Screen name="ui-kit" />
        <Stack.Screen name="status" />
        {/* публичные карточки по ссылке (блок 03, Q8): гость и вошедший; на native — поверх вкладок, без таб-бара */}
        <Stack.Screen name="races/[id]" />
      </Stack>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}
