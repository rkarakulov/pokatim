import type { DeviceProvider } from '@pokatim/contracts';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';

import {
  DeviceConnectError,
  parseDeviceReturn,
  returnUrlQuery,
  type ConnectOrigin,
  type ConnectResult,
} from './return-params';

/** Идёт сессия авторизации: ссылка возврата, пришедшая в Router (Android), — её, `devices/return` не завершает. */
let inFlight = 0;

export const isConnectInFlight = () => inFlight > 0;

/** Native: экран, начавший подключение, ждёт итог сам — сохранять, откуда пришли, не нужно. */
export function takeConnectOrigin(): ConnectOrigin | undefined {
  return undefined;
}

/**
 * Подключение (native): ссылка авторизации агрегатора → `openAuthSessionAsync` (iOS — ASWebAuthenticationSession,
 * Android — Custom Tabs) с возвратом на `pokatim://devices/return` (Expo Go — `exp://…`) → тикет из ссылки →
 * `complete` под входом. Закрыли браузер без возврата (`cancel`/`dismiss`, страница ошибки агрегатора) — `closed`:
 * экран обновляет список. `result=error` и мусорный тикет — `DeviceConnectError` без запроса.
 */
export async function connectDevice(
  provider: DeviceProvider,
  _origin: ConnectOrigin,
): Promise<ConnectResult> {
  inFlight += 1;
  try {
    const returnUrl = Linking.createURL('devices/return');
    const { authorizeUrl } = await withAccessToken((token) =>
      api.connectDevice(token, provider, { returnUrl }),
    );
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnUrl);
    if (result.type !== 'success') return { kind: 'closed' };
    const back = parseDeviceReturn(returnUrlQuery(result.url));
    if (back.kind === 'error') throw new DeviceConnectError();
    const devices = await withAccessToken((token) =>
      api.completeDevice(token, back.provider, { ticket: back.ticket }),
    );
    return { kind: 'connected', devices };
  } finally {
    inFlight -= 1;
  }
}
