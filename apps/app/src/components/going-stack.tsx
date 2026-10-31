import { inset, size, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from './icon';
import { RiderAvatar } from './rider-avatar';

/** Квадратов в стопке не больше: остальное — в подписи («идут 8 из 12»). */
const MAX_AVATARS = 4;

/**
 * Стопка идущих на райд (`.avstack` прототипа, как `AvatarStack` базы): квадраты 24 px внахлёст с кольцом цвета фона
 * и подпись. `avatarIds` («Свои» P2, карточка вошедшему) — аватары публичных участников в первых квадратах
 * (`RiderAvatar`, `null` — иконка); без пропа (лента, Главная, гость) — нейтральная иконка человека, а не пустое место,
 * похожее на незагруженную картинку (B10 смоука dev). Заглушка без фото — кандидат в `AvatarStack` базы
 * (`@rkarakulov/ui`). Для скринридера — один элемент с подписью.
 */
export function GoingStack({
  count,
  caption,
  avatarIds,
}: {
  count: number;
  caption: string;
  avatarIds?: readonly (string | null)[];
}) {
  const theme = useTheme();
  return (
    <View style={styles.stack} accessible accessibilityLabel={caption}>
      {Array.from({ length: Math.min(count, MAX_AVATARS) }, (_, index) => (
        <View
          key={index}
          style={[
            styles.ring,
            index > 0 && styles.overlap,
            { backgroundColor: theme.surface.default },
          ]}
        >
          {avatarIds && index < avatarIds.length ? (
            <RiderAvatar
              avatarId={avatarIds[index] ?? null}
              dimension={size.avatarStack}
              decorative
            />
          ) : (
            <View
              style={[
                styles.avatar,
                { borderColor: theme.text.primary, backgroundColor: theme.surface.raised },
              ]}
            >
              <Icon
                testID="going-avatar-icon"
                name="person"
                size={size.iconSm}
                color={theme.text.secondary}
                filled
              />
            </View>
          )}
        </View>
      ))}
      <Text style={[textStyle('meta'), styles.caption, { color: theme.text.secondary }]}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { minHeight: size.touchMin, flexDirection: 'row', alignItems: 'center' },
  ring: { padding: stroke.indicator },
  // кольцо цвета фона — padding обёртки, поэтому нахлёст увеличиваем на его ширину
  overlap: { marginLeft: -size.avatarOverlap - 2 * stroke.indicator },
  avatar: {
    width: size.avatarStack,
    height: size.avatarStack,
    borderWidth: stroke.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  caption: { marginLeft: inset.caption },
});
