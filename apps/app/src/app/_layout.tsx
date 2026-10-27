// дизайн-система (бренд, шрифты, i18n pokatim) — до любого модуля, который рендерит компоненты базы
import '@/theme/design-system';
import { layout } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GestureRoot } from '@/components/gesture-root';
import { useRegistrationStore } from '@/features/auth/registration-store';
import { takeReturnPath } from '@/features/auth/return-path';
import { useReturnTarget } from '@/features/auth/return-target';
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
  const router = useRouter();

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

  // возврат к карточке после входа (гость нажал «Я иду» / «Участвовать», Q13 блока 05): один раз, когда вошёл и прошёл
  // онбординг; путь — только из allowlist (`return-path`), действие повторно не выполняется. Путь забирается сразу после
  // входа и до выхода остаётся целью гарда шагов онбординга: иначе его редирект на Главную перебил бы возврат
  const returnTarget = useReturnTarget();
  useEffect(() => {
    if (!signedIn) {
      useReturnTarget.setState({ path: null, done: false });
      return;
    }
    if (useReturnTarget.getState().path !== null) return;
    const path = takeReturnPath();
    if (path) useReturnTarget.setState({ path, done: false });
  }, [signedIn]);
  useEffect(() => {
    if (!signedIn || step !== 'done' || returnTarget.path === null || returnTarget.done) return;
    useReturnTarget.setState({ done: true });
    router.replace(returnTarget.path as Href);
  }, [signedIn, step, returnTarget, router]);

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
      {/* широкий экран (web на десктопе, планшет): колонка экранов по центру, не шире токена (B20 смоука dev); фон по
          бокам — тема приложения, а не фон документа по системной схеме */}
      {/* корень жестов (routes-04): native — GestureHandlerRootView, web — View */}
      <GestureRoot style={[styles.root, { backgroundColor: theme.surface.default }]}>
        <View testID="app-column" style={styles.column}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.surface.default },
            }}
          >
            {/* вкладки: сессия или онбординг ещё неизвестны (скелетон, повтор) или онбординг пройден */}
            <Stack.Protected
              guard={
                isSessionPending(sessionStatus) ||
                (signedIn && (step === 'unknown' || step === 'done'))
              }
              redirectTo={
                signedIn
                  ? step === 'location'
                    ? '/location'
                    : step === 'devices'
                      ? '/devices'
                      : '/survey'
                  : returning
                    ? '/sign-in'
                    : '/register'
              }
            >
              <Stack.Screen name="(tabs)" />
              {/* «Устройства» (вход — иконка верхней панели): тот же гард, что у вкладок; скелетон — в экране
              (`useSettingsShell`) */}
              <Stack.Screen name="settings/devices" />
              {/* «Профиль» (profile-rider-name, вход — иконка верхней панели): тот же гард и оболочка, что у «Устройств» */}
              <Stack.Screen name="settings/profile" />
              {/* кофе-райды (блок 05): форма, правка и отмена — только вошедшим, без таб-бара; гость — «Вход» */}
              <Stack.Screen name="rides/new" />
              <Stack.Screen name="rides/edit/[id]" />
              <Stack.Screen name="rides/cancel/[id]" />
              {/* жалоба на райд (05b): только вошедшим; гость — «Вход» */}
              <Stack.Screen name="rides/report/[id]" />
              {/* свой маршрут (routes-02, M3, RC-11): только вошедшим, без таб-бара; гость — «Вход» */}
              <Stack.Screen name="routes/mine/[id]" />
              {/* «Выбрать свой заезд» в гонку (race-results-04): только вошедшим, без таб-бара */}
              <Stack.Screen name="races/pick/[id]" />
              {/* споры (race-results-06, RC-14): карточка соперника, подача и ответ — только вошедшим */}
              <Stack.Screen name="races/result/[id]/[entryId]" />
              <Stack.Screen name="races/dispute/[id]/[entryId]" />
              <Stack.Screen name="races/dispute-response/[id]/[disputeId]" />
            </Stack.Protected>
            {/* шаги онбординга после входа: опрос → геопозиция → устройства → Главная; пока сессия или шаг неизвестны — скелетон
            (SSR отдаёт HTML оболочки, а не пустую страницу редиректа) */}
            <Stack.Protected
              guard={isSessionPending(sessionStatus) || (signedIn && step !== 'done')}
              redirectTo={(returnTarget.path ?? '/') as Href}
            >
              <Stack.Screen name="(setup)" />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn} redirectTo="/">
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            {/* публичные экраны вне гардов: ссылка из письма — и до входа, и на другом устройстве */}
            <Stack.Screen name="auth/verify/[token]" />
            <Stack.Screen name="auth/reset/[token]" />
            {/* возврат из авторизации устройства (web — переход страницы, native — холодный старт по ссылке): и из шага
            онбординга, и из «Устройств»; вход экран проверяет сам */}
            <Stack.Screen name="devices/return" />
            <Stack.Screen name="ui-kit" />
            <Stack.Screen name="status" />
            {/* публичные карточки по ссылке (блок 03, Q8): гость и вошедший; на native — поверх вкладок, без таб-бара */}
            <Stack.Screen name="races/[id]" />
            {/* routes-01: публичная карточка маршрута каталога — гость открывает по ссылке (RC-9) */}
            <Stack.Screen name="routes/[id]" />
            <Stack.Screen name="seasons/[id]" />
            {/* публичная карточка старта календаря (блок 04) — так же */}
            <Stack.Screen name="calendar/[id]" />
            {/* публичная карточка кофе-райда (блок 05) — так же: ссылка-приглашение открывается без входа */}
            <Stack.Screen name="rides/[id]" />
          </Stack>
        </View>
      </GestureRoot>
      <StatusBar style="auto" />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
});
