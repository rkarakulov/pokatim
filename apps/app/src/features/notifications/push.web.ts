import type { RegisterWebPushSubscription } from '@pokatim/contracts';
import { useEffect, useState } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { accessClaims } from '@/features/auth/session-identity';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import type { DevicePushToken, PushPermission, PushPermissionState } from './push';

/**
 * Web Push в PWA (ADR-0021): подписка браузера (`PushManager`, VAPID) — тот же канал push, что Expo на native.
 * Поддержка — Service Worker + Push API + Notification, на iOS/iPadOS — только установленная PWA (standalone), и
 * сервер шлёт Web Push (`publicKey` не `null`). Всё, что трогает `window`/`navigator`, — только в вызовах после
 * монтирования: модуль грузится и в SSR.
 */

/** Ждём активный service worker не дольше этого (dev-сервер без `sw.js` — поддержки нет). */
const SW_READY_TIMEOUT_MS = 5_000;

/** Сообщения service worker окнам приложения (`scripts/service-worker.ts`). */
export const SW_MESSAGE = { push: 'pokatim:push', open: 'pokatim:open' } as const;

const isBrowser = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

/** iPhone/iPad (iPadOS выдаёт себя за Mac — по сенсорному экрану). */
function isAppleMobile(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Запущено как установленная PWA (с экрана «Домой» / из меню приложений). */
export function isStandalone(): boolean {
  if (!isBrowser()) return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Браузер умеет Web Push; iOS/iPadOS — только установленная PWA (16.4+, в обычной вкладке `PushManager` нет). */
export function browserSupportsPush(): boolean {
  if (!isBrowser()) return false;
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return false;
  }
  return !isAppleMobile() || isStandalone();
}

/** Публичный ключ VAPID сервера: запрос один раз на загрузку страницы; сбой не кешируется. */
let serverKey: Promise<string | null> | null = null;
function serverPublicKey(): Promise<string | null> {
  serverKey ??= withAccessToken((accessToken) => api.getWebPushConfig(accessToken))
    .then((config) => config.publicKey)
    .catch((error: unknown) => {
      serverKey = null;
      throw error;
    });
  return serverKey;
}

/** Поддержка целиком: браузер и сервер. Не бросает (сеть, нет сессии — `false`). */
async function webPushReady(): Promise<string | null> {
  if (!browserSupportsPush()) return null;
  try {
    return await serverPublicKey();
  } catch {
    return null;
  }
}

/**
 * Поддержан ли push на этой платформе: `null` — ещё неизвестно (SSR и первый рендер), дальше — браузер и сервер.
 * Экран без поддержки показывает только письма (как раньше в web).
 */
export function usePushSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void webPushReady().then((key) => {
      if (active) setSupported(key !== null);
    });
    return () => {
      active = false;
    };
  }, []);
  return supported;
}

/** В web нет перехода в настройки разрешения: объясняем, где включить (браузер или ОС). */
export const canOpenPushSettings = false;

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const sameBytes = (a: ArrayBuffer, b: Uint8Array) => {
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((byte, index) => byte === b[index]);
};

/** Подписка истекла (`expirationTime`) или выдана под другой ключ VAPID (сервер сменил пару). */
function isStale(subscription: PushSubscription, publicKey: string, now: number): boolean {
  if (subscription.expirationTime !== null && subscription.expirationTime <= now) return true;
  const key = subscription.options?.applicationServerKey;
  return key ? !sameBytes(key, fromBase64Url(publicKey)) : false;
}

/** Ключи подписки для сервера; браузер без них (не должен) — `null`. */
function toRegistration(subscription: PushSubscription): RegisterWebPushSubscription | null {
  const { keys } = subscription.toJSON();
  if (!keys?.p256dh || !keys.auth) return null;
  return { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/**
 * Подписка, которую сервер принял в этой загрузке страницы, — под какой сессией (`sid` access) и с каким endpoint:
 * подписка на сервере привязана к сессии, другой вход — регистрировать заново.
 */
let registered: { sid: string; endpoint: string } | null = null;

const currentSid = () => accessClaims(useSessionStore.getState().session?.accessToken)?.sid;
const isRegistered = (endpoint: string, sid: string | undefined) =>
  sid !== undefined && registered?.sid === sid && registered.endpoint === endpoint;

const fromNotification = (permission: NotificationPermission): PushPermission =>
  permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'undetermined';

/**
 * Реальное состояние: нет поддержки — `unavailable`; разрешение `default`/`denied`; `granted` — с подпиской этого
 * браузера: `active` (есть, свежая и принята сервером), `expired` (истекла или под старым ключом), `missing` (нет
 * или сервер её не принял). Отказ в браузере повторно не спрашивается (`canAskAgain: false`). Не бросает.
 */
export async function getPushPermission(): Promise<PushPermissionState> {
  const publicKey = await webPushReady();
  if (!publicKey) return { status: 'unavailable', canAskAgain: false };
  const status = fromNotification(Notification.permission);
  if (status !== 'granted') return { status, canAskAgain: status === 'undetermined' };
  try {
    const registration = await swRegistration();
    const subscription = (await registration?.pushManager.getSubscription()) ?? null;
    if (!subscription) return { status, canAskAgain: false, subscription: 'missing' };
    if (isStale(subscription, publicKey, Date.now())) {
      return { status, canAskAgain: false, subscription: 'expired' };
    }
    const active = isRegistered(subscription.endpoint, currentSid());
    return { status, canAskAgain: false, subscription: active ? 'active' : 'missing' };
  } catch {
    return { status, canAskAgain: false, subscription: 'missing' };
  }
}

/** Системный запрос браузера — только по нажатию (N5; Safari — только из жеста). Не бросает. */
export async function requestPushPermission(): Promise<PushPermissionState> {
  if (!(await webPushReady())) return { status: 'unavailable', canAskAgain: false };
  try {
    await Notification.requestPermission();
  } catch {
    // старый Safari без Promise-формы — состояние ниже
  }
  return getPushPermission();
}

export async function openPushSettings(): Promise<void> {}

/**
 * Подписка этого браузера — только при выданном разрешении: есть свежая под ключом сервера — она, иначе новая
 * (истёкшая или под старым ключом — сначала отписка). Без поддержки, разрешения или при сбое — `null`.
 */
export async function obtainPushToken(): Promise<DevicePushToken | null> {
  const publicKey = await webPushReady();
  if (!publicKey || Notification.permission !== 'granted') return null;
  try {
    const registration = await swRegistration();
    if (!registration) return null;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && isStale(subscription, publicKey, Date.now())) {
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(publicKey),
    });
    const body = toRegistration(subscription);
    return body ? { token: body.endpoint, platform: 'web', keys: body.keys } : null;
  } catch {
    return null;
  }
}

/**
 * Подписка — на сервер (upsert по endpoint, к сессии запроса); принятая — `active` в `getPushPermission`. Та же
 * подписка под той же сессией в этой загрузке страницы — без запроса (экран настроек сверяет состояние при каждом
 * открытии).
 */
export async function sendPushRegistration(
  accessToken: string,
  device: DevicePushToken,
): Promise<void> {
  if (device.platform !== 'web') return;
  const sid = accessClaims(accessToken)?.sid;
  if (isRegistered(device.token, sid)) return;
  await api.registerWebPushSubscription(accessToken, { endpoint: device.token, keys: device.keys });
  registered = sid ? { sid, endpoint: device.token } : null;
}

export async function sendPushRevoke(accessToken: string, token: string): Promise<void> {
  await api.revokeWebPushSubscription(accessToken, { endpoint: token });
}

/** Подписка — в самом браузере: «запоминать» нечего. */
export const storedPushToken = async (): Promise<string | null> => {
  if (!browserSupportsPush()) return null;
  try {
    const registration = await swRegistration();
    return (await registration?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
};
export async function rememberPushToken(_token: string): Promise<void> {}

/**
 * Выход: подписка браузера снимается и в самом браузере — следующий вошедший на этом устройстве чужих push не
 * получит, даже если запрос снятия на сервер не прошёл. Новый вход с выданным разрешением подписывает заново без
 * запроса. Не бросает.
 */
export async function forgetPushToken(): Promise<void> {
  registered = null;
  if (!browserSupportsPush()) return;
  try {
    const registration = await swRegistration();
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // нечего снимать
  }
}

/**
 * Сообщения service worker: нажатие на уведомление при открытом окне — `open` с целью (SW уже сфокусировал окно),
 * пришедший push — `receive` (обновить счётчик). Без открытого окна SW сам открывает путь цели. Возвращает отписку.
 */
export function subscribePushResponses(handlers: {
  onOpen: (target: unknown) => void;
  onReceive: () => void;
}): () => void {
  if (!isBrowser() || !('serviceWorker' in navigator)) return () => undefined;
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; target?: unknown } | null;
    if (data?.type === SW_MESSAGE.open) handlers.onOpen(data.target ?? null);
    else if (data?.type === SW_MESSAGE.push) handlers.onReceive();
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
