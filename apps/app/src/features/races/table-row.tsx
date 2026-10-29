import { motion, size, space } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { RiderAvatar } from '@/components/rider-avatar';
import { riderPath } from '@/features/riders/queries';

/** Действие строки таблицы: кнопка (карточка соперника, «Ваш результат») или ссылка (публичный профиль). */
export interface RowAction {
  role: 'button' | 'link';
  label: string;
  onPress: () => void;
}

/**
 * Действие строки таблицы (rider-links-in-tables): прежнее действие (`onPress` — карточка соперника / «Ваш
 * результат») важнее; иначе у публичного райдера (`profileA11y` есть только при `riderPublicId`) — ссылка на
 * `/riders/<publicId>`; иначе строка не нажимается.
 */
export function useRowAction(
  pressed: { label: string; onPress: () => void } | null,
  riderPublicId: string | null,
  profileA11y: string | null,
): RowAction | null {
  const router = useRouter();
  if (pressed) return { role: 'button', ...pressed };
  if (riderPublicId === null || profileA11y === null) return null;
  return {
    role: 'link',
    label: profileA11y,
    onPress: () => router.push(riderPath(riderPublicId)),
  };
}

/**
 * Строка таблицы (результаты, финишёры, сезон): с действием — `Pressable` с ролью и меткой действия (обратная связь —
 * прозрачность), без — один элемент для скринридера с меткой строки.
 */
export function TableRow({
  style,
  a11y,
  action,
  children,
}: {
  style: StyleProp<ViewStyle>;
  a11y: string;
  action: RowAction | null;
  children: ReactNode;
}) {
  if (action) {
    return (
      <Pressable
        accessibilityRole={action.role}
        accessibilityLabel={action.label}
        onPress={action.onPress}
        style={({ pressed }) => [style, { opacity: pressed ? motion.pressedOpacity : 1 }]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={a11y} style={style}>
      {children}
    </View>
  );
}

/**
 * Ячейка «кто»: у публичного райдера (`riderPublicId`) — аватар `size.avatarStack` (декоративный: метку несёт строка)
 * и имя; «Участник» — без аватара. Своя строка — «Вы» акцентом и `label`. `note` — вторая строка (финишёры).
 */
export function RiderWho({
  who,
  own,
  riderPublicId,
  avatarId,
  note,
}: {
  who: string;
  own: boolean;
  riderPublicId: string | null;
  avatarId: string | null;
  note?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.who}>
      {riderPublicId !== null ? (
        <RiderAvatar avatarId={avatarId} dimension={size.avatarStack} decorative />
      ) : null}
      <View style={styles.text}>
        <Text
          numberOfLines={1}
          style={[
            textStyle(own ? 'label' : 'body'),
            { color: own ? theme.text.accent : theme.text.primary },
          ]}
        >
          {who}
        </Text>
        {note ? (
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{note}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  text: { flex: 1 },
});
