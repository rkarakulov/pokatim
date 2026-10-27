import { t } from '@pokatim/i18n';
import { Banner } from '@rkarakulov/ui';
import { useEffect, useState } from 'react';

import {
  getPushPermission,
  openPushSettings,
  pushSupported,
  requestPushPermission,
  type PushPermissionState,
} from './push';
import { registerDevicePush } from './push-registration';

/**
 * Строка «Включить push-уведомления» (N5): системный запрос — только по нажатию; выдано — токен регистрируется
 * сразу. Отказ без повторного запроса — строка ведёт в настройки ОС. Выдано, модуль недоступен или web — строки нет.
 */
export function PushPermissionRow() {
  const [permission, setPermission] = useState<PushPermissionState | null>(null);

  useEffect(() => {
    if (!pushSupported) return;
    let active = true;
    void getPushPermission().then((state) => {
      if (active) setPermission(state);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!permission || permission.status === 'granted' || permission.status === 'unavailable') {
    return null;
  }

  if (permission.status === 'denied' && !permission.canAskAgain) {
    return (
      <Banner
        tone="warning"
        title={t('notifications.push.enable')}
        message={t('notifications.push.denied')}
        onPress={() => void openPushSettings()}
      />
    );
  }

  const enable = async () => {
    const next = await requestPushPermission();
    setPermission(next);
    if (next.status === 'granted') await registerDevicePush();
  };

  return (
    <Banner
      title={t('notifications.push.enable')}
      message={t('notifications.push.enableHint')}
      onPress={() => void enable()}
    />
  );
}
