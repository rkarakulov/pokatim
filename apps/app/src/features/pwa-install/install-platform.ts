/** Что о браузере нужно плашке установки (поля `navigator`; чистые функции — без глобалов). */
export interface BrowserInfo {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/** iPhone, iPod, iPad; iPadOS представляется Mac'ом (`MacIntel`) — отличаем по сенсорному экрану. */
export function isIosDevice({ userAgent, platform, maxTouchPoints }: BrowserInfo): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** Мобильный браузер: iOS/iPadOS или телефон/планшет Android и прочие `Mobi`. */
export function isMobileBrowser(info: BrowserInfo): boolean {
  return isIosDevice(info) || /Android|Mobi/i.test(info.userAgent);
}

/** Открыто как установленное PWA: `navigator.standalone` (iOS) или `display-mode: standalone`. */
export function isStandaloneDisplay(
  navigatorStandalone: boolean | undefined,
  displayModeStandalone: boolean,
): boolean {
  return navigatorStandalone === true || displayModeStandalone;
}

/** Мажорная версия Safari (`Version/N`); Chrome, Firefox, Opera, Edge на iOS и нет версии — `null`. */
export function safariMajorVersion(userAgent: string): number | null {
  if (!/AppleWebKit/i.test(userAgent) || /CriOS|FxiOS|OPiOS|EdgiOS/i.test(userAgent)) return null;
  const version = /Version\/(\d+)/i.exec(userAgent)?.[1];
  return version === undefined ? null : Number.parseInt(version, 10);
}

/** С iOS 26 Safari перенёс «Поделиться» и меню — у шагов инструкции свои картинки. */
export const IOS_26_SAFARI_VERSION = 26;

/** Набор картинок инструкции: Safari iOS 26+ — `ios26`, иначе (старый Safari, другие браузеры) — `legacy`. */
export function instructionVariant(userAgent: string): 'ios26' | 'legacy' {
  const version = safariMajorVersion(userAgent);
  return version !== null && version >= IOS_26_SAFARI_VERSION ? 'ios26' : 'legacy';
}
