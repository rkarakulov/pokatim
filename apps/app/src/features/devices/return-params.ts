import { DeviceReturnParams, type DeviceList, type DeviceProvider } from '@pokatim/contracts';

/** Откуда начато подключение — куда вернуться после `devices/return`. */
export type ConnectOrigin = 'onboarding' | 'settings';

export const CONNECT_ORIGIN_PATHS = {
  onboarding: '/devices',
  settings: '/settings/devices',
} as const satisfies Record<ConnectOrigin, string>;

export const isConnectOrigin = (value: unknown): value is ConnectOrigin =>
  value === 'onboarding' || value === 'settings';

/** Итог подключения: native — по закрытию браузера; web — страница уходит к агрегатору (`redirected`). */
export type ConnectResult =
  { kind: 'connected'; devices: DeviceList } | { kind: 'closed' } | { kind: 'redirected' };

/** Возврат из авторизации с `result=error` или без годного тикета: «Не удалось подключить. Повторите.» */
export class DeviceConnectError extends Error {
  constructor() {
    super('device connect failed');
    this.name = 'DeviceConnectError';
  }
}

export type DeviceReturn =
  { kind: 'pending'; provider: DeviceProvider; ticket: string } | { kind: 'error' };

/** Одно значение query (повтор параметра — мусор). */
const single = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * Разбор query возврата (`?provider&result&t`): `pending` с тикетом формата контракта — можно завершать; всё прочее
 * (`result=error`, нет/мусорный тикет, чужой провайдер, повтор параметра) — ошибка без запроса.
 */
export function parseDeviceReturn(query: Record<string, unknown> | null | undefined): DeviceReturn {
  const parsed = DeviceReturnParams.safeParse({
    provider: single(query?.provider),
    result: single(query?.result),
    t: single(query?.t),
  });
  if (!parsed.success || parsed.data.result !== 'pending' || parsed.data.t === undefined) {
    return { kind: 'error' };
  }
  return { kind: 'pending', provider: parsed.data.provider, ticket: parsed.data.t };
}

/**
 * Query ссылки возврата (`pokatim://devices/return?…`) без `Linking.parse` (тому нужен манифест сборки) и без `URL`
 * (`searchParams` в React Native неполный). Повтор параметра — массив: `parseDeviceReturn` считает его мусором.
 */
export function returnUrlQuery(url: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  const search = url.split('#')[0]?.split('?')[1] ?? '';
  for (const pair of search.split('&')) {
    if (!pair) continue;
    const [rawKey = '', rawValue = ''] = pair.split('=');
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      const seen = query[key];
      query[key] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value];
    } catch {
      // битая %-последовательность — параметр пропускается (тикет без него не пройдёт разбор)
    }
  }
  return query;
}
