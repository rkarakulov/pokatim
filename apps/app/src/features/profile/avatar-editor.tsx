import { t } from '@pokatim/i18n';
import { Button } from '@rkarakulov/ui';
import { useState } from 'react';

import { AvatarSection } from './avatar-section';
import { avatarErrorMessage } from './avatar-errors';
import { pickAvatar } from './pick-avatar';
import { useUploadAvatar } from './queries';

/**
 * Фото профиля на iOS и Android (rider-profile, AC14): «Выбрать фото» — системная галерея с обрезкой 1:1, затем
 * загрузка без `crop` (квадрат уже вырезан). Кнопка занята на время выбора и загрузки; отмена — без запроса; ошибки
 * (старый dev-клиент, размер, 413/415/422/429, сеть) — баннер блока.
 */
export function AvatarEditor({ avatarId }: { avatarId: string | null }) {
  const upload = useUploadAvatar();
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState<string>();

  const onPick = async () => {
    setFailure(undefined);
    setPicking(true);
    try {
      const picked = await pickAvatar();
      if (picked) await upload.mutateAsync({ body: picked.body });
    } catch (error) {
      setFailure(avatarErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };

  return (
    <AvatarSection avatarId={avatarId} failure={failure} onFailure={setFailure}>
      <Button
        label={t('profile.avatar.pick')}
        variant="secondary"
        loading={picking || upload.isPending}
        onPress={() => void onPick()}
      />
    </AvatarSection>
  );
}
