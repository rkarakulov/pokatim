import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ridePhotoErrorMessage } from './invite/ride-photo-errors';
import { useDeleteRidePhoto } from './queries';

/**
 * «Удалить фото» в карточке райда организатору, когда экран приглашения уже недоступен — райд прошёл или отменён
 * (ride-photo P2: удалить своё фото можно всегда). Показывает вызывающий: `role === 'organizer'`, без `canManage`, при
 * `ride.photo` (у скрытого райда view отдаёт `photo: null` — снимает модератор или стирание). Кнопка занята на время
 * запроса, ошибка — баннер; ответ — кеш `me` и инвалидация `['rides']` (блок пропадёт вместе с фото).
 */
export function RidePhotoDelete({ rideId }: { rideId: string }) {
  const theme = useTheme();
  const remove = useDeleteRidePhoto(rideId);
  const [failure, setFailure] = useState<string>();
  return (
    <View testID="ride-photo-delete" style={styles.stack}>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('rides.detail.photoHint')}
      </Text>
      <View style={styles.start}>
        <TextAction
          label={t('rides.detail.photoDelete')}
          destructive
          disabled={remove.isPending}
          onPress={() => {
            setFailure(undefined);
            remove.mutate(undefined, {
              onError: (error) => setFailure(ridePhotoErrorMessage(error, 'delete')),
            });
          }}
        />
      </View>
      {failure ? <Banner tone="error" message={failure} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
