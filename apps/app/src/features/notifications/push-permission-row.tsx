import { t, type MessageKey } from '@pokatim/i18n';
import { Banner } from '@rkarakulov/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

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

type RowAction = 'request' | 'subscribe' | 'settings' | null;

/**
 * Текст отказа без повторного запроса — общий для строки и подсказки (`push-soft-prompt.tsx`): native ведёт в
 * настройки ОС, web объясняет, где включить (браузер или система).
 */
export function deniedRow(): { message: MessageKey; warning: true; action: 'settings' | null } {
  return canOpenPushSettings
    ? { message: 'notifications.push.denied', warning: true, action: 'settings' }
    : { message: 'notifications.push.deniedBrowser', warning: true, action: null };
}

/** Текст строки по состоянию; `null` — строки нет (нет поддержки или push уже работает). */
function rowOf(permission: PushPermissionState): {
  message: MessageKey;
  warning?: boolean;
  action: RowAction;
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
  if (status === 'denied' && !canAskAgain) return deniedRow();
  return { message: 'notifications.push.enableHint', action: 'request' };
}

/** Состояние push этого устройства — одно на экран: строку и тумблеры групп оно держит согласованными. */
export interface PushPermissionControl {
  /** `null` — ещё проверяется */
  permission: PushPermissionState | null;
  /**
   * Push дойдут до этого устройства: разрешение выдано и (web) подписка принята сервером. `null` — ещё неизвестно
   * или push на платформе нет — подсказок «не придут» не показываем.
   */
  delivers: boolean | null;
  /**
   * Действие строки: системный запрос, подписка или настройки ОС (отказ навсегда). Возвращает состояние после
   * запроса или подписки (`null` — ничего не спрашивали: настройки, занято, состояние неизвестно). Не бросает.
   */
  press: () => Promise<PushPermissionState | null>;
  /**
   * Включён тумблер группы: разрешение ещё не спрашивали — системный запрос (тот же жест: Safari показывает запрос
   * только из нажатия, поэтому вызывать до сохранения настроек); разрешено без подписки — тихая подписка. Отказ и
   * «отказ навсегда» сами по себе ничего не открывают — объясняет строка. Не бросает.
   */
  enableFromToggle: () => Promise<PushPermissionState | null>;
}

function deliversOf(permission: PushPermissionState | null): boolean | null {
  if (!permission || permission.status === 'unavailable') return null;
  if (permission.status !== 'granted') return false;
  return permission.subscription === undefined || permission.subscription === 'active';
}

export function usePushPermission(): PushPermissionControl {
  const [permission, setPermission] = useState<PushPermissionState | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    void currentPermission().then((state) => {
      if (active) setPermission(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(
    async (action: RowAction): Promise<PushPermissionState | null> => {
      if (!permission || !action || busy.current) return null;
      busy.current = true;
      try {
        if (action === 'settings') {
          await openPushSettings();
          return null;
        }
        const next = action === 'request' ? await requestPushPermission() : permission;
        if (next.status === 'granted') await registerDevicePush();
        // web сверяет подписку после регистрации; native при выданном разрешении строки больше нет
        const settled = next.subscription ? await getPushPermission() : next;
        setPermission(settled);
        return settled;
      } finally {
        busy.current = false;
      }
    },
    [permission],
  );

  const press = useCallback(
    () => run(permission ? (rowOf(permission)?.action ?? null) : null),
    [permission, run],
  );
  const enableFromToggle = useCallback(() => {
    const action = permission ? (rowOf(permission)?.action ?? null) : null;
    return run(action === 'request' || action === 'subscribe' ? action : null);
  }, [permission, run]);

  return { permission, delivers: deliversOf(permission), press, enableFromToggle };
}

/**
 * Строка «Включить push-уведомления» (N5): системный запрос — только по нажатию; выдано — токен (web — подписка)
 * регистрируется сразу. Отказ без повторного запроса — native ведёт в настройки ОС, web объясняет, где включить
 * (браузер или система). Web: разрешение есть, а подписки нет или она истекла — строка подписывает заново.
 * Push работает или его нет на платформе — строки нет. `control` — общее состояние экрана с тумблерами групп;
 * без него строка держит своё (центр уведомлений).
 */
export function PushPermissionRow({ control }: { control?: PushPermissionControl }) {
  return control ? <Row control={control} /> : <OwnRow />;
}

function OwnRow() {
  return <Row control={usePushPermission()} />;
}

function Row({ control }: { control: PushPermissionControl }) {
  const row = control.permission ? rowOf(control.permission) : null;
  if (!row) return null;
  return (
    <Banner
      tone={row.warning ? 'warning' : undefined}
      title={t('notifications.push.enable')}
      message={t(row.message)}
      onPress={row.action ? () => void control.press() : undefined}
    />
  );
}
