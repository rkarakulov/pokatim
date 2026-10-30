import type { RideDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { ShareChoiceSheet } from '@/features/sharing/share-choice-sheet';
import { shareOrigin } from '@/lib/share-link';

import { rideShareText } from './format';

/**
 * Шит «Райд опубликован» (прототип (d)) на общем выборе `ShareChoiceSheet`: «Карточка-приглашение» (экран карточки),
 * «Ссылка» (сразу системное меню `shareLink`), «Закрыть». Ссылка отправлена — шит закрывается; меню закрыли —
 * остаётся; web без Web Share — «Ссылка скопирована» в шите. Нет web-origin (dev native) — только карточка.
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
  const canLink = shareOrigin() !== null;
  return (
    <ShareChoiceSheet
      title={t('rides.published.title')}
      text={t(canLink ? 'rides.published.text' : 'rides.published.textNoLink')}
      cardLabel={t('rideInvite.open')}
      onCard={onInvite}
      link={
        canLink ? { title: ride.title, text: rideShareText(ride), path: `/rides/${ride.id}` } : null
      }
      onClose={onClose}
      testID="ride-published-sheet"
    />
  );
}
