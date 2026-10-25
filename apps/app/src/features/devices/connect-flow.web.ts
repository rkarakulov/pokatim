import type { DeviceProvider } from '@pokatim/contracts';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';

import { leavePageTo } from './leave-page.web';
import { isConnectOrigin, type ConnectOrigin, type ConnectResult } from './return-params';

/** Откуда начато подключение — `sessionStorage` вкладки: возврат приходит новой загрузкой страницы этой вкладки. */
const ORIGIN_KEY = 'pokatim.devicesConnectOrigin';

/** Web: подключение — переход страницы, «сессии авторизации» внутри приложения нет. */
export const isConnectInFlight = () => false;

/** Откуда пришли (шаг онбординга или «Устройства»); значение одноразовое — читается и удаляется. */
export function takeConnectOrigin(): ConnectOrigin | undefined {
  try {
    const value = window.sessionStorage.getItem(ORIGIN_KEY);
    window.sessionStorage.removeItem(ORIGIN_KEY);
    return isConnectOrigin(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Подключение (web): ссылка авторизации агрегатора с возвратом на `<origin>/devices/return` → откуда пришли — в
 * `sessionStorage` вкладки → переход страницы (`location.assign`). Дальше — экран `devices/return` после возврата.
 */
export async function connectDevice(
  provider: DeviceProvider,
  origin: ConnectOrigin,
): Promise<ConnectResult> {
  const returnUrl = `${window.location.origin}/devices/return`;
  const { authorizeUrl } = await withAccessToken((token) =>
    api.connectDevice(token, provider, { returnUrl }),
  );
  try {
    window.sessionStorage.setItem(ORIGIN_KEY, origin);
  } catch {
    // хранилище недоступно (приватный режим) — вернёмся в «Устройства» по умолчанию
  }
  leavePageTo(authorizeUrl);
  return { kind: 'redirected' };
}
