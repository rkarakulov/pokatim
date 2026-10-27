/// <reference types="jest" />
// Дизайн-система с настоящим брендом проекта (темы, шрифты, i18n) — первым, до модулей экранов.
import './src/theme/design-system';
// RNGH v3 (routes-04: жесты скраббинга): моки нативного модуля и детектора; события — `fireGestureHandler`
import 'react-native-gesture-handler/jestSetup';
// Моки нативных модулей для всех тестов: в jest нет ни NetInfo, ни нативного пикера.
import { onlineManager } from '@tanstack/react-query';

import type * as ReactNative from 'react-native';

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
// getCurrentPositionAsync читает только «Моё местоположение» по нажатию (routes-04d, G1): тесты карты задают ответ,
// онбординг его не вызывает (сторож в location.test.tsx)
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(),
}));

// push (ADR-0016): разрешение ещё не спрашивали, устройство — не симулятор; тесты push задают ответы сами
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async () => ({
    type: 'expo',
    data: 'ExpoPushToken[test-device-token]',
  })),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-device', () => ({ isDevice: true }));

// RNGH v3 без Reanimated (routes-04: колбэки жестов — `runOnJS`): mock Reanimated 4.7 падает на `setCSSEventHandler`,
// и `expo-router/testing-library` подменяет пакет пустым объектом — RNGH принимает его за установленный и падает на
// `isSharedValue`. Обёртка RNGH «Reanimated не установлен» — для src- и lib-сборки пакета.
jest.mock('react-native-gesture-handler/src/handlers/gestures/reanimatedWrapper', () => ({
  Reanimated: undefined,
  Worklets: undefined,
}));
jest.mock('react-native-gesture-handler/lib/module/handlers/gestures/reanimatedWrapper', () => ({
  Reanimated: undefined,
  Worklets: undefined,
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

// MapLibre (ADR-0014): нативного модуля в jest нет — компоненты карты как View с пропсами (тесты читают их через
// UNSAFE_getByType или testID); дети источника рендерятся. `Map` и `Camera` (routes-04b) — с `ref`: методы — общие
// `jest.fn` модуля (`__camera`, `__map`; тесты чистят их сами), до нативного вида `getViewState`/`getZoom` отклоняются
jest.mock('@maplibre/maplibre-react-native', () => {
  const { createElement, useImperativeHandle } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const notReady = () => Promise.reject(new Error('jest: нативной карты нет'));
  const camera = {
    jumpTo: jest.fn(),
    easeTo: jest.fn(),
    flyTo: jest.fn(),
    zoomTo: jest.fn(),
    fitBounds: jest.fn(),
    setStop: jest.fn(async () => undefined),
  };
  const map = { getViewState: jest.fn(notReady), getZoom: jest.fn(notReady) };
  const stub = (name: string, methods?: object) => {
    const Component = ({ ref, ...props }: { ref?: unknown; children?: unknown }) => {
      useImperativeHandle(ref, () => methods ?? null, []);
      return createElement(View, { testID: `maplibre-${name}`, ...props });
    };
    Component.displayName = name;
    return Component;
  };
  return {
    __camera: camera,
    __map: map,
    Map: stub('Map', map),
    Camera: stub('Camera', camera),
    GeoJSONSource: stub('GeoJSONSource'),
    Layer: stub('Layer'),
  };
});

// ленивый загрузчик карты (`import()` jest не исполняет) — сразу мок пакета выше
jest.mock('./src/features/maps/load-maplibre-native', () => ({
  loadMapLibreNative: jest.fn(async () => jest.requireMock('@maplibre/maplibre-react-native')),
}));

// react-native-svg (routes-04 G2): нативного модуля в jest нет — элементы как View с пропсами (testID `svg-<имя>`),
// загрузчик — сразу мок; модули «установлены» (spy ниже), тест фолбэка подменяет их на null
jest.mock('react-native-svg', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const stub = (name: string) => {
    const Component = (props: { children?: unknown }) =>
      createElement(View, { testID: `svg-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  return {
    Svg: stub('Svg'),
    Defs: stub('Defs'),
    LinearGradient: stub('LinearGradient'),
    Stop: stub('Stop'),
    Path: stub('Path'),
  };
});
jest.mock('./src/features/routes/load-svg-native', () => ({
  loadSvgNative: jest.fn(async () => jest.requireMock('react-native-svg')),
}));

// нативные модули MapLibre и react-native-svg «установлены» (dev-сборка); тест Expo Go подменяет `get` на null
const turboModules = jest.requireActual<typeof ReactNative>('react-native').TurboModuleRegistry;
const turboModuleGet = turboModules.get.bind(turboModules);
function withMapLibreModules() {
  jest
    .spyOn(turboModules, 'get')
    .mockImplementation(
      (name: string) =>
        (name.startsWith('MLRN') || name.startsWith('RNSVG') ? {} : turboModuleGet(name)) as never,
    );
}

// onlineManager — синглтон модуля: каждый тест начинает как свежий запуск приложения
beforeEach(() => {
  onlineManager.setOnline(true);
  withMapLibreModules();
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
