import type { RideDetail } from '@pokatim/contracts';
import { space, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';
import { shareLink, shareOrigin } from '@/lib/share-link';

import { rideShareText } from './format';

/**
 * Шит «Райд опубликован» (прототип (d)): два пути пригласить — «Карточка-приглашение» (экран карточки) и «Ссылка»
 * (сразу системное меню `shareLink`), явное «Закрыть». Ссылка отправлена — шит закрывается; меню закрыли — остаётся;
 * web без Web Share — «Ссылка скопирована» в шите. Нет web-origin (dev native) — только карточка.
 */
export function RidePublishedSheet({
  ride,
  onInvite,
  onClose,
}: {
  ride: RideDetail;
  onInvite: () => void;
  onClose: () => void;
}) {
  const theme = useTheme<AppTheme>();
  const [notice, setNotice] = useState<'copied' | 'failed' | null>(null);
  const [sharing, setSharing] = useState(false);
  const canLink = shareOrigin() !== null;

  const share = () => {
    setNotice(null);
    setSharing(true);
    shareLink({ title: ride.title, text: rideShareText(ride), path: `/rides/${ride.id}` })
      .then((outcome) => {
        if (outcome === 'shared') onClose();
        else setNotice(outcome === 'copied' ? 'copied' : null);
      })
      .catch(() => setNotice('failed'))
      .finally(() => setSharing(false));
  };

  return (
    <ModalSheet title={t('rides.published.title')} onClose={onClose} testID="ride-published-sheet">
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t(canLink ? 'rides.published.text' : 'rides.published.textNoLink')}
      </Text>
      <View style={styles.actions}>
        <Button label={t('rideInvite.open')} onPress={onInvite} />
        {canLink ? (
          <Button
            label={t('rides.published.link')}
            variant="secondary"
            disabled={sharing}
            onPress={share}
          />
        ) : null}
        {notice === 'copied' ? <Banner message={t('rides.detail.copied')} /> : null}
        {notice === 'failed' ? (
          <Banner tone="warning" message={t('rides.detail.shareFailed')} />
        ) : null}
        <View style={styles.close}>
          <TextAction label={t('rides.published.close')} onPress={onClose} />
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.s2 },
  close: { alignItems: 'center' },
});
