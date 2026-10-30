import { layout, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RiderAvatar } from '@/components/rider-avatar';

import { avatarBlockedText, avatarErrorMessage } from './avatar-errors';
import { useDeleteAvatar } from './queries';

/**
 * «Удалить фото» с инлайн-подтверждением (нативный `Alert` на web не работает): «Удалить фото?» — «Удалить» /
 * «Оставить»; кнопка занята на время запроса, ошибка — баннер блока.
 */
function DeleteAvatar({ onFailure }: { onFailure: (message: string | undefined) => void }) {
  const theme = useTheme();
  const remove = useDeleteAvatar();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <View style={styles.start}>
        <TextAction
          label={t('profile.avatar.delete')}
          destructive
          onPress={() => {
            onFailure(undefined);
            setConfirming(true);
          }}
        />
      </View>
    );
  }
  return (
    <View testID="avatar-delete-confirm" style={styles.stack}>
      <Text style={[textStyle('bodyStrong'), { color: theme.text.primary }]}>
        {t('profile.avatar.deleteTitle')}
      </Text>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('profile.avatar.deleteBody')}
      </Text>
      <Button
        label={t('profile.avatar.deleteConfirm')}
        loading={remove.isPending}
        onPress={() =>
          remove.mutate(undefined, {
            onSuccess: () => setConfirming(false),
            onError: (error) => onFailure(avatarErrorMessage(error, 'delete')),
          })
        }
      />
      <View style={styles.start}>
        <TextAction
          label={t('profile.avatar.keep')}
          disabled={remove.isPending}
          onPress={() => setConfirming(false)}
        />
      </View>
    </View>
  );
}

/**
 * Блок «Фото» формы «Редактировать профиль» (rider-profile, AC14) — общий для native и web: заголовок, аватар 56,
 * подсказка про геометки, действия платформы (`children`), «Удалить фото» при фото, ошибка — баннер под кнопками.
 * Запрет загрузки (`blockedUntil`) — подпись «Загрузка фото недоступна до …» сразу под кнопкой выбора (кнопку
 * выключает платформа); «Удалить фото» остаётся доступной.
 */
export function AvatarSection({
  avatarId,
  blockedUntil,
  failure,
  onFailure,
  children,
}: {
  avatarId: string | null;
  blockedUntil: string | null;
  failure: string | undefined;
  onFailure: (message: string | undefined) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View testID="avatar-editor" style={styles.stack}>
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {t('profile.avatar.title')}
      </Text>
      <View style={styles.start}>
        <RiderAvatar avatarId={avatarId} dimension={layout.avatarProfile} />
      </View>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('profile.avatar.hint')}
      </Text>
      {children}
      {blockedUntil ? (
        <Text testID="avatar-blocked" style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {avatarBlockedText(blockedUntil)}
        </Text>
      ) : null}
      {avatarId !== null ? <DeleteAvatar onFailure={onFailure} /> : null}
      {failure ? <Banner tone="error" message={failure} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
