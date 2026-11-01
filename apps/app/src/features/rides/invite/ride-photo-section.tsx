import { apiErrorOf } from '@pokatim/api-client';
import { RIDE_PHOTO_MAX_BYTES, type RidePhotoRef, type RideView } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  SkeletonGroup,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PICK_IMAGE_BUSY_WHILE_OPEN, pickImage } from '@/features/media/pick-image';

import { useDeleteRidePhoto, useRideForViewer, useUploadRidePhoto } from '../queries';
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
  // web: диалог файла кнопку не занимает (`PICK_IMAGE_BUSY_WHILE_OPEN`) — без `cancel` она залипла бы
  const uploading = (PICK_IMAGE_BUSY_WHILE_OPEN && picking) || upload.isPending;

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

/** Загрузка фото — организатору с правом правки (решает сервер: `canManage`). */
const managesPhoto = ({ viewer }: RideView) => viewer.role === 'organizer' && viewer.canManage;

/**
 * Блок «Своё фото» на экране приглашения по состоянию зрителя `me` (§4.12): первая загрузка — скелетон блока, ошибка без
 * данных — «Нет соединения» / «Не удалось загрузить» с повтором, ошибка обновления — блок остаётся с баннером
 * (`AsyncContent`). После ответа — только организатору с правом правки (`canManage`: будущий опубликованный, не скрытый);
 * остальным и при 404 (скрытый, неизвестный — карточка уже показывает «Приглашение недоступно») — ничего.
 */
export function RidePhotoBlock({ rideId }: { rideId: string }) {
  const me = useRideForViewer(rideId, true);
  if (apiErrorOf(me.error)?.code === 'NOT_FOUND') return null;
  if (me.data && !managesPhoto(me.data)) return null;
  return (
    <AsyncContent
      query={me}
      skeleton={
        <SkeletonGroup>
          <SkeletonText variant="body" lines={3} lastLineWidth="60%" />
        </SkeletonGroup>
      }
    >
      {(view) => <RidePhotoSection rideId={rideId} photo={view.ride.photo} />}
    </AsyncContent>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
