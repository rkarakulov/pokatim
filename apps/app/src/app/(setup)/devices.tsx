import { isNetworkError } from '@pokatim/api-client';
import type { DeviceProvider, DeviceView } from '@pokatim/contracts';
import { size } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Banner, Button, Skeleton, TextAction } from '@rkarakulov/ui';

import { DocumentTitle } from '@/components/document-title';
import { AuthActions, AuthScreen, AuthStack, AuthText } from '@/features/auth/auth-screen';
import { actionErrorMessage } from '@/features/auth/error-messages';
import { deviceActionErrorMessage } from '@/features/devices/error-messages';
import { needsDeviceConnect } from '@/features/devices/format';
import { useConnectDevice, useDevices } from '@/features/devices/queries';
import { useCompleteDevicesStep } from '@/features/onboarding/queries';

const DOCUMENT_TITLE = `${t('devices.step.title')} — ${t('app.name')}`;

const saveErrorMessage = (error: unknown) =>
  isNetworkError(error) ? actionErrorMessage(error) : t('devices.step.saveFailed');

type ConnectableDevice = DeviceView & { provider: DeviceProvider };

const isConnectable = (device: DeviceView): device is ConnectableDevice =>
  device.provider !== 'unknown' &&
  device.available &&
  device.status !== 'disconnecting' &&
  needsDeviceConnect(device);

// подключение начато, но не подтверждено (`pending`) или его нужно обновить — начать заново
const connectLabel = (device: DeviceView) =>
  device.status === 'pending' || device.issue === 'reauthorize'
    ? t('devices.reconnectProvider', { name: device.name })
    : t('devices.connectProvider', { name: device.name });

/**
 * Шаг онбординга «Подключите устройство» (после геопозиции, один раз на аккаунт): кнопки доступных провайдеров и
 * «Позже». После подключения (native — по возврату из браузера; web — `devices/return` ведёт обратно сюда) —
 * «Garmin подключён» и «Продолжить». Подключать нечего (все `available: false`, сервер без агрегатора) — подсказка
 * про загрузку файлом. Состояния `GET /v1/devices` — `AsyncContent` («Нет соединения» / «Не удалось загрузить» с
 * повтором; ошибка обновления — баннер поверх провайдеров); «Позже» доступна всегда. `pending` (подтверждение не
 * пришло) — «Подключить Garmin снова». Любой исход — флаг шага на сервере (ошибка — баннер, повтор той же кнопкой) → Главная.
 */
export default function DevicesStepScreen() {
  const devices = useDevices();
  const connect = useConnectDevice('onboarding');
  const finish = useCompleteDevicesStep();

  const items = devices.data?.items ?? [];
  const connected = items.find((device) => device.status === 'active' && device.issue === null);

  const later = (
    <TextAction
      label={t('devices.step.later')}
      onPress={() => finish.mutate('later')}
      disabled={finish.isPending || connect.isPending}
    />
  );

  const content = () => {
    if (connected) {
      return (
        <>
          <AuthText>{t('devices.connected', { name: connected.name })}</AuthText>
          <Button
            label={t('devices.step.continue')}
            onPress={() => finish.mutate('connected')}
            loading={finish.isPending}
          />
        </>
      );
    }
    // состояния запроса — `AsyncContent`: скелетон, «Нет соединения» / «Не удалось загрузить» с повтором, ошибка
    // обновления — баннер поверх провайдеров; подключать нечего (успешный ответ) — подсказка про загрузку файлом
    return (
      <>
        <AsyncContent
          query={devices}
          skeleton={
            <AuthStack>
              <Skeleton height={size.buttonHeight} />
              <Skeleton height={size.buttonHeight} />
            </AuthStack>
          }
          empty={{
            when: (list) => !list.items.some(isConnectable),
            render: () => <AuthText tone="secondary">{t('devices.step.fileHint')}</AuthText>,
          }}
        >
          {(list) => (
            <AuthStack>
              {list.items.filter(isConnectable).map((device) => (
                <Button
                  key={device.provider}
                  label={connectLabel(device)}
                  onPress={() => connect.mutate(device.provider)}
                  loading={connect.isPending && connect.variables === device.provider}
                  disabled={connect.isPending || finish.isPending}
                />
              ))}
            </AuthStack>
          )}
        </AsyncContent>
        {later}
      </>
    );
  };

  return (
    <AuthScreen
      kicker={t('onboarding.kicker')}
      title={t('devices.step.title')}
      lead={t('devices.step.lead')}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <AuthActions>
        {connect.isError ? (
          <Banner tone="error" message={deviceActionErrorMessage(connect.error)} />
        ) : null}
        {finish.isError ? <Banner tone="error" message={saveErrorMessage(finish.error)} /> : null}
        {content()}
      </AuthActions>
    </AuthScreen>
  );
}
