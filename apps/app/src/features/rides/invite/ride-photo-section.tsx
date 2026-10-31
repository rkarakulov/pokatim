import { RIDE_PHOTO_MAX_BYTES, type RidePhotoRef } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { pickImage } from '@/features/media/pick-image';

import { useDeleteRidePhoto, useUploadRidePhoto } from '../queries';
import { ridePhotoErrorMessage } from './ride-photo-errors';

/**
 * Блок «Своё фото» экрана карточки-приглашения (ride-photo P3, AC7) — только организатору, которому сервер разрешает
 * правку (`viewer.canManage`). «Добавить своё фото» / «Заменить фото» — общий `pickImage(.web)` без обрезки (вписывает
 * сервер), затем `PUT` байтами; «Удалить фото» — только при фото (квота `rides-manage` не тратится впустую). Кнопки
 * заняты на время выбора и запросов, друг друга выключают; ошибка — баннер блока. Новое фото видно на шаблоне «Ночь»
 * (карточку перерисовывает сервер: инвалидация `['rides']` даёт новый токен).
 */
export function RidePhotoSection({
  rideId,
  photo,
}: {
  rideId: string;
  photo: RidePhotoRef | null;
}) {
  const theme = useTheme();
  const upload = useUploadRidePhoto(rideId);
  const remove = useDeleteRidePhoto(rideId);
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState<string>();
  const uploading = picking || upload.isPending;

  const onPick = async () => {
    setFailure(undefined);
    setPicking(true);
    try {
      const picked = await pickImage({ maxBytes: RIDE_PHOTO_MAX_BYTES, square: false });
      if (picked) await upload.mutateAsync(picked.body);
    } catch (error) {
      setFailure(ridePhotoErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };

  const onDelete = () => {
    setFailure(undefined);
    remove.mutate(undefined, {
      onError: (error) => setFailure(ridePhotoErrorMessage(error, 'delete')),
    });
  };

  return (
    <View testID="ride-photo" style={styles.stack}>
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {t('rideInvite.photo.title')}
      </Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('rideInvite.photo.hint')}
      </Text>
      <Button
        label={t(photo ? 'rideInvite.photo.replace' : 'rideInvite.photo.add')}
        variant="secondary"
        loading={uploading}
        disabled={remove.isPending}
        onPress={() => void onPick()}
      />
      {photo ? (
        <View style={styles.start}>
          <TextAction
            label={t('rideInvite.photo.delete')}
            destructive
            disabled={remove.isPending || uploading}
            onPress={onDelete}
          />
        </View>
      ) : null}
      {failure ? <Banner tone="error" message={failure} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
