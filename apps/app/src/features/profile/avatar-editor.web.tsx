import { t } from '@pokatim/i18n';
import { Button } from '@rkarakulov/ui';
import { useState } from 'react';

import { AvatarCrop } from './avatar-crop.web';
import { avatarErrorMessage } from './avatar-errors';
import { AvatarSection } from './avatar-section';
import { pickAvatar } from './pick-avatar';
import { AvatarPrecheckError } from './picked-avatar';
import { useUploadAvatar } from './queries';

/**
 * Фото профиля в браузере (rider-profile, AC14): «Выбрать фото» — файл JPEG/PNG/WebP (проверка формата и размера до
 * обрезки), затем инлайн-панель обрезки на месте кнопки (не модалка: работает и в SSR-разметке, без порталов).
 * «Сохранить фото» — исходник и доли квадрата; ошибка — баннер, панель остаётся для повтора; «Отмена» — без запроса.
 */
export function AvatarEditor({ avatarId }: { avatarId: string | null }) {
  const upload = useUploadAvatar();
  const [file, setFile] = useState<File>();
  const [failure, setFailure] = useState<string>();

  const onPick = async () => {
    setFailure(undefined);
    try {
      const picked = await pickAvatar();
      if (picked?.file) setFile(picked.file);
    } catch (error) {
      setFailure(avatarErrorMessage(error));
    }
  };

  return (
    <AvatarSection avatarId={avatarId} failure={failure} onFailure={setFailure}>
      {file ? (
        <AvatarCrop
          file={file}
          saving={upload.isPending}
          onCancel={() => setFile(undefined)}
          onUnreadable={() => {
            setFile(undefined);
            setFailure(avatarErrorMessage(new AvatarPrecheckError('AVATAR_INVALID')));
          }}
          onTooSmall={() => {
            setFile(undefined);
            setFailure(avatarErrorMessage(new AvatarPrecheckError('tooSmall')));
          }}
          onConfirm={(crop) => {
            setFailure(undefined);
            upload.mutate(
              { body: file, crop },
              {
                onSuccess: () => setFile(undefined),
                onError: (error) => setFailure(avatarErrorMessage(error)),
              },
            );
          }}
        />
      ) : (
        <Button
          label={t('profile.avatar.pick')}
          variant="secondary"
          onPress={() => void onPick()}
        />
      )}
    </AvatarSection>
  );
}
