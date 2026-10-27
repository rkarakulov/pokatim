import type { PushPlatform } from '@pokatim/contracts';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { secureStorage } from '@/features/auth/secure-storage';

/**
 * Push на native (ADR-0016, `expo-notifications`). Web — `push.web.ts` (web push нет, N1): экраны и хуки импортируют
 * модуль без расширения и не знают платформы.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface PushPermissionState {
  status: PushPermission;
  /** системный запрос ещё можно показать; `false` при отказе — строка ведёт в настройки ОС (N5) */
  canAskAgain: boolean;
}

export interface DevicePushToken {
  token: string;
  platform: PushPlatform;
}

export const pushSupported = true;

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

/** Системный запрос — только по нажатию «Включить push-уведомления» (N5). Не бросает. */
export async function requestPushPermission(): Promise<PushPermissionState> {
  try {
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
 * иначе или при сбое — `null` (центр и колокольчик работают без push). Канал Android создаётся до токена.
 */
export async function obtainPushToken(): Promise<DevicePushToken | null> {
  const projectId = easProjectId();
  if (!projectId || !Device.isDevice) return null;
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  if (!platform) return null;
  try {
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return null;
    if (platform === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: ANDROID_CHANNEL,
        importance: AndroidImportance.DEFAULT,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data, platform };
  } catch {
    return null;
  }
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

/**
 * Нажатия на push: холодный старт (последний ответ) и живые нажатия → `onOpen(target)`; пришедший при открытом
 * приложении push показывается баннером и зовёт `onReceive` (обновить счётчик). Возвращает отписку.
 */
export function subscribePushResponses(handlers: {
  onOpen: (target: unknown) => void;
  onReceive: () => void;
}): () => void {
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
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handlers.onOpen(targetOf(last));
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handlers.onOpen(targetOf(response));
      Notifications.clearLastNotificationResponse();
    });
    return () => {
      subscription.remove();
      Notifications.setNotificationHandler(null);
    };
  } catch {
    return () => undefined;
  }
}
