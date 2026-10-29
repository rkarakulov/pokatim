import type { PushPlatform, RegisterWebPushSubscription } from '@pokatim/contracts';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { secureStorage } from '@/features/auth/secure-storage';
import { api } from '@/lib/api';

/**
 * Push на native (ADR-0017, `expo-notifications`). Web — `push.web.ts` (Web Push в PWA, ADR-0021): экраны и хуки
 * импортируют модуль без расширения и не знают платформы.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface PushPermissionState {
  status: PushPermission;
  /** системный запрос ещё можно показать; `false` при отказе — строка ведёт в настройки ОС (N5) */
  canAskAgain: boolean;
  /**
   * Подписка этого устройства при `granted` — только web (ADR-0021): `active` — есть и принята сервером, `missing` —
   * нет или не принята, `expired` — истекла или выдана под старым ключом. Native — нет поля (токен — всегда).
   */
  subscription?: 'active' | 'missing' | 'expired';
}

/** Токен Expo (native) или подписка Web Push (`token` — endpoint, по нему подписка снимается при выходе). */
export type DevicePushToken =
  | { token: string; platform: PushPlatform }
  | { token: string; platform: 'web'; keys: RegisterWebPushSubscription['keys'] };

/** Push на этой платформе есть всегда (native); web — после проверки браузера и сервера (`null` — ещё неизвестно). */
export const usePushSupported = (): boolean | null => true;

/** Отказ навсегда — строка ведёт в настройки приложения в ОС; в web такого перехода нет. */
export const canOpenPushSettings = true;

/** Канал Android, который указывает сервер (`channelId: 'default'`). */
const ANDROID_CHANNEL = 'default';
/** Последний зарегистрированный токен устройства — снять его при выходе. */
const TOKEN_KEY = 'pokatim.pushToken';

const fromStatus = (status: string): PushPermission =>
  status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';

/** Состояние разрешения; модуль недоступен (старый dev-клиент) — `unavailable`. Не бросает. */
export async function getPushPermission(): Promise<PushPermissionState> {
  try {
    const result = await Notifications.getPermissionsAsync();
    return { status: fromStatus(result.status), canAskAgain: result.canAskAgain };
  } catch {
    return { status: 'unavailable', canAskAgain: false };
  }
}

/**
 * Канал Android `default` (его указывает сервер). На Android 13+ системный запрос разрешения не показывается, пока
 * у приложения нет ни одного канала, — поэтому канал создаётся до запроса и до проверки разрешения. Иначе — no-op.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: ANDROID_CHANNEL,
    importance: AndroidImportance.DEFAULT,
  });
}

/** Системный запрос — только по нажатию «Включить push-уведомления» (N5); Android — после канала. Не бросает. */
export async function requestPushPermission(): Promise<PushPermissionState> {
  try {
    await ensureAndroidChannel();
    const result = await Notifications.requestPermissionsAsync();
    return { status: fromStatus(result.status), canAskAgain: result.canAskAgain };
  } catch {
    return { status: 'unavailable', canAskAgain: false };
  }
}

/** Настройки приложения в ОС (отказ навсегда). Не бросает. */
export async function openPushSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // настроек нет (симулятор) — строка остаётся
  }
}

/** `projectId` EAS из `app.json` (`extra.eas.projectId`); нет — регистрации нет (RC-11, runbook push). */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Токен Expo этого устройства — только при выданном разрешении, на устройстве (не симулятор) и с `projectId`;
 * иначе или при сбое — `null` (центр и колокольчик работают без push). Канал Android создаётся до проверки разрешения.
 */
export async function obtainPushToken(): Promise<DevicePushToken | null> {
  const projectId = easProjectId();
  if (!projectId || !Device.isDevice) return null;
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  if (!platform) return null;
  try {
    await ensureAndroidChannel();
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data, platform };
  } catch {
    return null;
  }
}

/** Регистрация токена этого устройства на сервере (`PUT /v1/notifications/push-tokens`). */
export async function sendPushRegistration(
  accessToken: string,
  device: DevicePushToken,
): Promise<void> {
  if (device.platform === 'web') return;
  await api.registerPushToken(accessToken, { token: device.token, platform: device.platform });
}

export async function sendPushRevoke(accessToken: string, token: string): Promise<void> {
  await api.revokePushToken(accessToken, { token });
}

export const storedPushToken = (): Promise<string | null> =>
  secureStorage.get(TOKEN_KEY).catch(() => null);

export async function rememberPushToken(token: string): Promise<void> {
  try {
    await secureStorage.set(TOKEN_KEY, token);
  } catch (error) {
    console.warn(`push token not stored: ${(error as Error).name}`);
  }
}

export async function forgetPushToken(): Promise<void> {
  try {
    await secureStorage.delete(TOKEN_KEY);
  } catch {
    // нечего удалять
  }
}

/** Цель из данных push (`data.target`); разбирает её белый список (`notification-target.ts`). */
const targetOf = (response: Notifications.NotificationResponse): unknown =>
  (response.notification.request.content.data as { target?: unknown } | null)?.target ?? null;

/** Сбой подключения к модулю уведомлений — в лог, без текста push. */
const warnPush = (step: string, error: unknown) =>
  console.warn(`push ${step} failed: ${(error as Error).name}`);

/**
 * Нажатия на push: живые нажатия и холодный старт (последний ответ) → `onOpen(target)`; пришедший при открытом
 * приложении push показывается баннером и зовёт `onReceive` (обновить счётчик). Вызывать, когда навигатор смонтирован
 * (`PushNotifications`). Слушатель ставится первым и не зависит от сбоя обработчика показа; ответ гасится только после
 * перехода — не удавшийся переход повторится при следующей подписке. Возвращает отписку.
 */
export function subscribePushResponses(handlers: {
  onOpen: (target: unknown) => void;
  onReceive: () => void;
}): () => void {
  const open = (response: Notifications.NotificationResponse) => {
    try {
      handlers.onOpen(targetOf(response));
      Notifications.clearLastNotificationResponse();
    } catch (error) {
      warnPush('open', error);
    }
  };
  let subscription: { remove: () => void } | null = null;
  try {
    subscription = Notifications.addNotificationResponseReceivedListener(open);
  } catch (error) {
    warnPush('subscribe', error);
  }
  let handlerSet = false;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => {
        handlers.onReceive();
        return {
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      },
    });
    handlerSet = true;
  } catch (error) {
    warnPush('handler', error);
  }
  try {
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last);
  } catch (error) {
    warnPush('last response', error);
  }
  return () => {
    subscription?.remove();
    if (handlerSet) Notifications.setNotificationHandler(null);
  };
}
