import { t, type MessageKey } from '@pokatim/i18n';
import { Banner } from '@rkarakulov/ui';
import { useEffect, useState } from 'react';

import {
  canOpenPushSettings,
  getPushPermission,
  openPushSettings,
  requestPushPermission,
  type PushPermissionState,
} from './push';
import { registerDevicePush } from './push-registration';

/**
 * Реальное состояние push устройства: при выданном разрешении без действующей подписки (web) сначала тихо
 * регистрирует её — так после перезагрузки и входа строка показывает то, что есть на сервере, а не в браузере.
 */
async function currentPermission(): Promise<PushPermissionState> {
  const state = await getPushPermission();
  if (state.status !== 'granted' || !state.subscription || state.subscription === 'active') {
    return state;
  }
  await registerDevicePush();
  return getPushPermission();
}

/** Текст строки по состоянию; `null` — строки нет (нет поддержки или push уже работает). */
function rowOf(permission: PushPermissionState): {
  message: MessageKey;
  warning?: boolean;
  action: 'request' | 'subscribe' | 'settings' | null;
} | null {
  const { status, canAskAgain, subscription } = permission;
  if (status === 'unavailable') return null;
  if (status === 'granted') {
    if (subscription === 'missing')
      return { message: 'notifications.push.subscribeHint', action: 'subscribe' };
    if (subscription === 'expired') {
      return { message: 'notifications.push.expired', warning: true, action: 'subscribe' };
    }
    return null;
  }
  if (status === 'denied' && !canAskAgain) {
    return canOpenPushSettings
      ? { message: 'notifications.push.denied', warning: true, action: 'settings' }
      : { message: 'notifications.push.deniedBrowser', warning: true, action: null };
  }
  return { message: 'notifications.push.enableHint', action: 'request' };
}

/**
 * Строка «Включить push-уведомления» (N5): системный запрос — только по нажатию; выдано — токен (web — подписка)
 * регистрируется сразу. Отказ без повторного запроса — native ведёт в настройки ОС, web объясняет, где включить
 * (браузер или система). Web: разрешение есть, а подписки нет или она истекла — строка подписывает заново.
 * Push работает или его нет на платформе — строки нет.
 */
export function PushPermissionRow() {
  const [permission, setPermission] = useState<PushPermissionState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void currentPermission().then((state) => {
      if (active) setPermission(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const row = permission ? rowOf(permission) : null;
  if (!row) return null;

  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (row.action === 'settings') {
        await openPushSettings();
        return;
      }
      const next = row.action === 'request' ? await requestPushPermission() : permission!;
      if (next.status === 'granted') await registerDevicePush();
      setPermission(next.status === 'granted' ? await getPushPermission() : next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Banner
      tone={row.warning ? 'warning' : undefined}
      title={t('notifications.push.enable')}
      message={t(row.message)}
      onPress={row.action ? () => void press() : undefined}
    />
  );
}
