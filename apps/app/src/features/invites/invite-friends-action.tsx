import { t } from '@pokatim/i18n';
import { Banner, TextAction } from '@rkarakulov/ui';
import { useState } from 'react';

import { shareLink, shareOrigin } from '@/lib/share-link';
import { useMounted } from '@/lib/use-minsk-clock';

import { useOwnInviteCode } from './queries';

type Notice = 'copied' | 'failed' | null;

/** Путь ссылки «Позвать друзей»: свой публичный профиль, иначе — главная (код добавляет `shareLink`). */
export const inviteFriendsPath = (publicId: string | null) =>
  publicId !== null ? `/riders/${encodeURIComponent(publicId)}` : '/';

/**
 * «Позвать друзей» в своём профиле (P6, K9): ссылка на публичный профиль (или главную) с личным кодом. Кнопка — только
 * когда есть origin шеринга (web — после монтирования) и код уже получен (RC-P6-12); `shareLink` — синхронно в
 * обработчике (web: `navigator.share` до любого `await`).
 */
export function InviteFriendsAction({ publicId }: { publicId: string | null }) {
  const mounted = useMounted();
  const code = useOwnInviteCode().data?.code;
  const [notice, setNotice] = useState<Notice>(null);
  if (!mounted || shareOrigin() === null || !code) return null;

  const share = () => {
    setNotice(null);
    shareLink({
      title: t('invites.friends.shareTitle'),
      text: t('invites.friends.shareText'),
      path: inviteFriendsPath(publicId),
    })
      .then((outcome) => setNotice(outcome === 'copied' ? 'copied' : null))
      .catch(() => setNotice('failed'));
  };

  return (
    <>
      <TextAction label={t('invites.friends.action')} onPress={share} />
      {notice === 'copied' ? <Banner message={t('invites.friends.copied')} /> : null}
      {notice === 'failed' ? <Banner tone="warning" message={t('invites.friends.failed')} /> : null}
    </>
  );
}
