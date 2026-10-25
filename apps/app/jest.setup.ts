/// <reference types="jest" />
// Дизайн-система с настоящим брендом проекта (темы, шрифты, i18n) — первым, до модулей экранов.
import './src/theme/design-system';
// Моки нативных модулей для всех тестов: в jest нет ни NetInfo, ни нативного пикера.
import { onlineManager } from '@tanstack/react-query';

import type * as RegistrationStore from './src/features/auth/registration-store';
import type * as OnboardingStore from './src/features/onboarding/onboarding-store';
import type * as SessionStore from './src/features/auth/session-store';

// в jest нет Keychain: in-memory хранилище; тесты читают его через jest.requireMock('expo-secure-store').__store
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// геопозиция: по умолчанию разрешение уже выдано — шаг онбординга пропускается (тесты шага задают своё);
// getCurrentPositionAsync — сторож: координаты приложение не читает (Q6)
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Нативный модуль ExpoHead — как в dev client и сборках iOS (в Expo Go его нет): с ним `expo-router/head`
// регистрирует NSUserActivity и без `origin` у плагина expo-router бросает ошибку при рендере. Мок ловит
// `<Head>` вне `.web`-файлов. Модуль читается при первом импорте expo-router/head — задаём до него.
const expoGlobal = globalThis as { expo?: { modules?: Record<string, unknown> } };
expoGlobal.expo = {
  ...expoGlobal.expo,
  modules: {
    ...expoGlobal.expo?.modules,
    ExpoHead: {
      activities: { INDEXED_ROUTE: 'expo.modules.router.indexed_route' },
      createActivity: jest.fn(),
      suspendActivity: jest.fn(),
      clearActivitiesWithIds: jest.fn(),
    },
  },
};

jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  // iOS-пикер — хост-элемент с пропсами: тест вызывает fireEvent(picker, 'valueChange', event, date)
  const DateTimePicker = (props: object) =>
    createElement(View, { testID: 'date-picker', ...props });
  return {
    __esModule: true,
    default: DateTimePicker,
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
  };
});

// onlineManager — синглтон модуля: каждый тест начинает как свежий запуск приложения
beforeEach(() => {
  onlineManager.setOnline(true);
  // сторы сессии и регистрации — тоже синглтоны; сброс до теста, а не после: в afterEach экраны
  // прошлого теста ещё смонтированы (сброс стора вне act)
  jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store.clear();
  // сторы — из реестра модулей теста, а не при загрузке setup: стор сессии тянет `@/lib/api`, и импорт здесь
  // закешировал бы настоящий клиент раньше `jest.mock('@/lib/api')` тестового файла
  jest.requireActual<typeof SessionStore>('./src/features/auth/session-store').resetSessionStore();
  jest
    .requireActual<typeof RegistrationStore>('./src/features/auth/registration-store')
    .resetRegistrationStore();
  jest
    .requireActual<typeof OnboardingStore>('./src/features/onboarding/onboarding-store')
    .resetOnboardingStore();
});
