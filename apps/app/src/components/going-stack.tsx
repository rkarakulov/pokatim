import { inset, size, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from './icon';

/** Квадратов в стопке не больше: остальное — в подписи («идут 8 из 12»). */
const MAX_AVATARS = 4;

/**
 * Стопка идущих на райд (`.avstack` прототипа, как `AvatarStack` базы): квадраты 24 px внахлёст с кольцом цвета фона
 * и подпись. Имён и фото у идущих нет (Q4 блока 05) — в квадрате нейтральная иконка человека, а не пустое место,
 * похожее на незагруженную картинку (B10 смоука dev). Заглушка без фото — кандидат в `AvatarStack` базы
 * (`@rkarakulov/ui`). Для скринридера — один элемент с подписью.
 */
export function GoingStack({ count, caption }: { count: number; caption: string }) {
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
