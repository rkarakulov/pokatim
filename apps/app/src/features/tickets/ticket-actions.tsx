import type { TicketEventSummary } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { openExternalUrl } from '@/lib/open-external-url';
import { shareLink, shareOrigin } from '@/lib/share-link';
import { useMounted } from '@/lib/use-minsk-clock';

import { directionsUrl } from './maps-link';
import { directionsQuery, eventPath, ticketShareInput } from './ticket-format';

type Notice = 'copied' | 'shareFailed' | 'mapsFailed' | null;

/**
 * Действия билета (plan-B §2.6): «Как добраться» — внешние карты по адресу (RC-B3, синхронно в обработчике),
 * «О событии» — карточка, «Поделиться» — ссылка на событие без кода и QR (RC-B2; нет origin — кнопки нет; web — после
 * монтирования).
 */
export function TicketActions({ event }: { event: TicketEventSummary }) {
  const router = useRouter();
  const mounted = useMounted();
  const [notice, setNotice] = useState<Notice>(null);
  const query = directionsQuery(event);
  const path = eventPath(event);
  const share = mounted && shareOrigin() !== null ? ticketShareInput(event) : null;

  const openMaps = (text: string) => {
    setNotice(null);
    openExternalUrl(directionsUrl(text)).catch(() => setNotice('mapsFailed'));
  };
  const shareEvent = (input: NonNullable<typeof share>) => {
    setNotice(null);
    shareLink(input)
      .then((outcome) => setNotice(outcome === 'copied' ? 'copied' : null))
      .catch(() => setNotice('shareFailed'));
  };

  return (
    <View style={styles.actions}>
      {query ? (
        <Button
          label={t('tickets.action.directions')}
          variant="secondary"
          onPress={() => openMaps(query)}
        />
      ) : null}
      {path ? (
        <Button
          label={t('tickets.action.event')}
          variant="secondary"
          onPress={() => router.push(path as Href)}
        />
      ) : null}
      {share ? (
        <Button
          label={t('tickets.action.share')}
          variant="secondary"
          onPress={() => shareEvent(share)}
        />
      ) : null}
      {notice === 'copied' ? <Banner message={t('tickets.shareCopied')} /> : null}
      {notice === 'shareFailed' ? (
        <Banner tone="warning" message={t('tickets.shareFailed')} />
      ) : null}
      {notice === 'mapsFailed' ? (
        <Banner tone="warning" message={t('tickets.directionsFailed')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.s2 },
});
