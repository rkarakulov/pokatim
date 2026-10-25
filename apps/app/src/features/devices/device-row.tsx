import type { DeviceView } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  Button,
  Checkbox,
  Pill,
  TextAction,
  textStyle,
  useTheme,
  type PillTone,
} from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { deviceActionErrorMessage, syncErrorMessage } from './error-messages';
import { deviceStatusLabel, formatMinskDateTime, isDeviceConnected } from './format';
import { useConnectDevice, useDisconnectDevice, useSyncDevice } from './queries';

function statusTone(device: DeviceView): PillTone {
  if (device.issue === 'reauthorize') return 'warning';
  return device.status === 'active' ? 'success' : 'neutral';
}

interface DeviceRowProps {
  device: DeviceView;
  /** «сейчас» для подписи «Синхронизировано …» (год показываем, только если не текущий) */
  now: Date;
  first: boolean;
}

/**
 * Провайдер на экране «Устройства»: статус, «Синхронизировано …» по Минску, проблема (`issue`) с действием,
 * «Подключить» / «Подключить снова», «Синхронизировать сейчас», «Отключить» с подтверждением и галочкой «Удалить заезды
 * из …» (по умолчанию выключена). `available: false` — «Подключение временно недоступно», без подключения.
 */
export function DeviceRow({ device, now, first }: DeviceRowProps) {
  const theme = useTheme();
  const connect = useConnectDevice('settings');
  const sync = useSyncDevice();
  const disconnect = useDisconnectDevice();
  const [confirming, setConfirming] = useState(false);
  const [deleteActivities, setDeleteActivities] = useState(false);

  // провайдер, которого сборка не знает (сервер новее), — только строка статуса
  const provider = device.provider === 'unknown' ? null : device.provider;
  const connected = isDeviceConnected(device);
  const needsConnect = device.issue === 'reauthorize' || !connected;
  const canConnect =
    provider !== null && device.available && needsConnect && device.status !== 'disconnecting';
  const canSync =
    provider !== null && device.available && device.status === 'active' && !needsConnect;
  const canDisconnect = provider !== null && connected;

  const onDisconnect = async () => {
    if (provider === null) return;
    try {
      await disconnect.mutateAsync({ provider, deleteActivities });
      setConfirming(false);
      setDeleteActivities(false);
    } catch {
      // ошибка — баннер в подтверждении, решение пользователя не теряем
    }
  };

  const meta = (text: string) => (
    <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{text}</Text>
  );

  return (
    <View
      testID={`device-${device.provider}`}
      style={[
        styles.row,
        first ? null : { borderTopColor: theme.border.subtle, ...styles.divided },
      ]}
    >
      <View style={styles.head}>
        <Text style={[textStyle('titleSm'), { color: theme.text.primary }, styles.name]}>
          {device.name}
        </Text>
        <Pill label={deviceStatusLabel(device)} tone={statusTone(device)} />
      </View>
      {device.available ? null : meta(t('devices.unavailable'))}
      {connected && device.lastSyncedAt
        ? meta(t('devices.syncedAt', { date: formatMinskDateTime(device.lastSyncedAt, now) }))
        : null}
      {device.issue === 'sync_failed' ? (
        <Banner tone="warning" message={t('devices.syncFailed')} />
      ) : null}
      {device.issue === 'revoke_failed' && provider !== null ? (
        <Banner message={t(`devices.revokeFailed.${provider}`)} />
      ) : null}

      {connect.isError ? (
        <Banner tone="error" message={deviceActionErrorMessage(connect.error)} />
      ) : null}
      {sync.isError ? <Banner tone="error" message={syncErrorMessage(sync.error)} /> : null}
      {sync.isSuccess ? meta(t('devices.syncStarted')) : null}

      {canConnect && provider !== null ? (
        <Button
          label={device.issue === 'reauthorize' ? t('devices.reconnect') : t('devices.connect')}
          onPress={() => connect.mutate(provider)}
          loading={connect.isPending}
        />
      ) : null}
      {canSync && provider !== null ? (
        <Button
          variant="secondary"
          label={t('devices.syncNow')}
          onPress={() => sync.mutate(provider)}
          loading={sync.isPending}
        />
      ) : null}

      {canDisconnect && confirming ? (
        <View style={styles.confirm}>
          <Text style={[textStyle('body'), { color: theme.text.primary }]}>
            {t('devices.disconnectConfirm', { name: device.name })}
          </Text>
          <Checkbox
            label={t('devices.deleteActivities', { name: device.name })}
            checked={deleteActivities}
            onChange={setDeleteActivities}
          />
          {disconnect.isError ? (
            <Banner tone="error" message={deviceActionErrorMessage(disconnect.error)} />
          ) : null}
          <Button
            label={t('devices.disconnect')}
            onPress={() => void onDisconnect()}
            loading={disconnect.isPending}
          />
          <TextAction
            label={t('devices.cancel')}
            onPress={() => {
              setConfirming(false);
              setDeleteActivities(false);
              disconnect.reset();
            }}
            disabled={disconnect.isPending}
          />
        </View>
      ) : null}
      {canDisconnect && !confirming && device.status !== 'disconnecting' ? (
        <View style={styles.action}>
          <TextAction
            label={t('devices.disconnect')}
            destructive
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: size.rowPadding, gap: space.s3 },
  divided: { borderTopWidth: stroke.hairline },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  name: { flex: 1 },
  confirm: { gap: space.s3 },
  action: { alignItems: 'flex-start' },
});
