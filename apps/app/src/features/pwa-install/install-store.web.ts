import { create } from 'zustand';

import { isIosDevice, isMobileBrowser, isStandaloneDisplay } from './install-platform';
import {
  dismissInstallPrompt,
  INSTALL_PROMPT_KEY,
  readInstallPromptState,
  registerVisit,
  type InstallPromptState,
} from './install-prompt-state';

/** Событие Chromium «можно установить» (нет в lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

interface RelatedApplicationsNavigator {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<readonly unknown[]>;
}

/** Параметр ссылки рассылок: открыть промо установки, без счётчика. */
export const PROMO_PARAM = 'show-pwa-modal';

interface InstallStore {
  /** браузер прочитан (`startInstallPrompt`); до этого (SSR, гидрация) — ничего не показываем */
  ios: boolean | null;
  mobile: boolean;
  standalone: boolean;
  /** PWA установлено; до ответа `getInstalledRelatedApps` — `null`, считаем «установлено», чтобы плашка не мигала */
  installed: boolean | null;
  /** отложенный `beforeinstallprompt` (Android/Chromium): нативный диалог доступен */
  deferredPrompt: BeforeInstallPromptEvent | null;
  prompt: InstallPromptState;
  /** открыть промо по ссылке `?show-pwa-modal` */
  promoRequested: boolean;
}

const initial: InstallStore = {
  ios: null,
  mobile: false,
  standalone: false,
  installed: null,
  deferredPrompt: null,
  prompt: { showDialog: false, visitsCountAfterClosing: 0 },
  promoRequested: false,
};

export const useInstallStore = create<InstallStore>(() => initial);

/** Установку можно предложить: не PWA, не установлено, iOS (вручную) или есть отложенный нативный диалог. */
export const canInstall = (state: InstallStore): boolean =>
  state.ios !== null &&
  !state.standalone &&
  state.installed === false &&
  (state.ios || state.deferredPrompt !== null);

/** Плашка: мобильный браузер, установка возможна и сработал счётчик. */
export const bannerVisible = (state: InstallStore): boolean =>
  state.mobile && state.prompt.showDialog && canInstall(state);

/** Промо по ссылке: условия установки — да, счётчик — нет. */
export const promoVisible = (state: InstallStore): boolean =>
  state.promoRequested && canInstall(state);

function savePrompt(state: InstallPromptState): void {
  try {
    globalThis.localStorage?.setItem(
      INSTALL_PROMPT_KEY,
      JSON.stringify({
        visitsCountAfterClosing: state.visitsCountAfterClosing,
        closedTimestamp: state.closedTimestamp,
      }),
    );
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}

function loadPrompt(): InstallPromptState {
  try {
    return readInstallPromptState(globalThis.localStorage?.getItem(INSTALL_PROMPT_KEY) ?? null);
  } catch {
    return readInstallPromptState(null);
  }
}

/** Ответ `getInstalledRelatedApps`: только в top-level (из cross-origin iframe бросает); нет API, ошибка — «не установлено». */
async function detectInstalled(): Promise<boolean> {
  try {
    if (window.top !== window.self) return false;
    const apps = await (navigator as RelatedApplicationsNavigator).getInstalledRelatedApps?.();
    return (apps?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Убрать `?show-pwa-modal` из адресной строки сразу (`replaceState`, состояние истории навигатора — как было); из
 * состояния роутера параметр снимает плашка (`router.setParams`).
 */
function takePromoParam(): boolean {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PROMO_PARAM)) return false;
  url.searchParams.delete(PROMO_PARAM);
  window.history.replaceState(window.history.state, '', url.toString());
  return true;
}

/**
 * Chromium шлёт `beforeinstallprompt` рано, до монтирования Главной: слушатели — при загрузке модуля в браузере
 * (на SSR `window` нет). Событие откладываем (`preventDefault` — без мини-инфобара браузера) и показываем свою плашку.
 */
function listenInstallEvents(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    useInstallStore.setState({ deferredPrompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    useInstallStore.setState({ installed: true, deferredPrompt: null });
  });
}

if (typeof window !== 'undefined') listenInstallEvents();

/**
 * Первое монтирование плашки за загрузку страницы (Главная — только у вошедшего): читаем браузер, считаем визит,
 * спрашиваем `getInstalledRelatedApps`, забираем `?show-pwa-modal`. Повторные монтирования — без визита.
 * Возвращает `true`, если в адресе был параметр промо.
 */
export function startInstallPrompt(): boolean {
  if (useInstallStore.getState().ios !== null) return false;
  const info = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
  const prompt = registerVisit(loadPrompt(), Date.now());
  savePrompt(prompt);
  const promoRequested = takePromoParam();
  useInstallStore.setState({
    ios: isIosDevice(info),
    mobile: isMobileBrowser(info),
    standalone: isStandaloneDisplay(
      (navigator as RelatedApplicationsNavigator).standalone,
      window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    ),
    prompt,
    promoRequested,
  });
  // `appinstalled` мог прийти раньше ответа — его не затираем
  void detectInstalled().then((installed) =>
    useInstallStore.setState((state) => ({ installed: state.installed === true || installed })),
  );
  return promoRequested;
}

/** «×» плашки: скрыть, счётчик с нуля, время закрытия. */
export function dismissInstallBanner(): void {
  const prompt = dismissInstallPrompt(Date.now());
  savePrompt(prompt);
  useInstallStore.setState({ prompt });
}

export function closePromo(): void {
  useInstallStore.setState({ promoRequested: false });
}

/** Нативный диалог установки (Chromium): событие одноразовое — после ответа диалога больше нет. */
export async function promptInstall(): Promise<void> {
  const event = useInstallStore.getState().deferredPrompt;
  if (!event) return;
  useInstallStore.setState({ deferredPrompt: null });
  await event.prompt();
}
