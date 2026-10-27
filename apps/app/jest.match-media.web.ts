// jsdom без `window.matchMedia`: react-native-web при загрузке модуля читает `(prefers-reduced-motion: reduce)`, без
// него `AccessibilityInfo.addEventListener` возвращает `undefined` и `useReducedMotion` базы падает при размонтировании
// (routes-04b: кнопки карты). Заглушка «настройка выключена» — до загрузки модулей (`setupFiles`); тесты reduce motion
// подменяют `AccessibilityInfo.isReduceMotionEnabled`.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
