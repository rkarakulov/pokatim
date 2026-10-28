import { size, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { useTheme } from '@rkarakulov/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api } from '@/lib/api';

import { Icon } from './icon';

export interface RiderAvatarProps {
  /** id аватара из `ProfileView.avatar` / `PublicRiderProfile.avatar`; нет — пустой квадрат с иконкой человека */
  avatarId: string | null;
  /** сторона квадрата — токен (`size.avatarTopBar`, `layout.avatarProfile`) */
  dimension: number;
  /** фон пустого квадрата: по умолчанию `surface.raised`, в шапке профиля — `surface.default` (`.phead-name .ava`) */
  background?: 'raised' | 'default';
  /** аватар внутри кнопки (верхняя панель): метку несёт кнопка, сам квадрат скрыт от скринридера */
  decorative?: boolean;
}

/**
 * Аватар райдера (`.ava` прототипа, rider-profile): квадрат с рамкой `text.primary` во всех темах. Фото — `expo-image`
 * по публичному URL (`immutable`, новый id при замене — дисковый кэш безопасен); нет фото или ошибка загрузки
 * (удалённый аватар → 404, сеть) — иконка человека на фоне, как в `GoingStack`. Базовый `Avatar` (`@rkarakulov/ui`)
 * этого не умеет — follow-up в app-foundation: плейсхолдер и подмена картинки, `size.avatarLg`.
 */
export function RiderAvatar({
  avatarId,
  dimension,
  background = 'raised',
  decorative = false,
}: RiderAvatarProps) {
  const theme = useTheme();
  // ошибка — для конкретного id: новое фото (новый id) пробуем заново
  const [failedId, setFailedId] = useState<string | null>(null);
  const photo = avatarId !== null && failedId !== avatarId ? avatarId : null;
  return (
    <View
      testID="rider-avatar"
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={
        decorative ? undefined : t(photo ? 'profile.avatar.a11y' : 'profile.avatar.empty')
      }
      style={[
        styles.frame,
        {
          width: dimension,
          height: dimension,
          borderColor: theme.text.primary,
          backgroundColor: background === 'raised' ? theme.surface.raised : theme.surface.default,
        },
      ]}
    >
      {photo ? (
        <Image
          testID="rider-avatar-photo"
          source={{ uri: api.avatarUrl(photo) }}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
          onError={() => setFailedId(photo)}
        />
      ) : (
        <Icon
          testID="rider-avatar-empty"
          name="person"
          size={size.icon}
          color={theme.text.secondary}
          filled
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: stroke.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
});
