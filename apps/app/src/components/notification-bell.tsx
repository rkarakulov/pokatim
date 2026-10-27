import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './icon';

/** Больше — «99+» (N9; сервер считает до 100). */
const COUNT_MAX = 99;

/** Подпись счётчика: 0 — нет, больше 99 — «99+». */
export const unreadBadge = (count: number): string | null =>
  count <= 0 ? null : count > COUNT_MAX ? t('notifications.countMax') : String(count);

function bellLabel(count: number): string {
  if (count <= 0) return t('notifications.bell');
  if (count > COUNT_MAX) return t('notifications.bellUnreadMax');
  return t('notifications.bellUnread', { count });
}

interface NotificationBellProps {
  /** непрочитанные; неизвестно (загрузка, ошибка) — без счётчика */
  count: number | undefined;
  onPress: () => void;
}

/** Колокольчик верхней панели Главной (`docs/product/home.md`): иконка и счётчик непрочитанных — `Pill` базы. */
export function NotificationBell({ count, onPress }: NotificationBellProps) {
  const theme = useTheme();
  const badge = unreadBadge(count ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bellLabel(count ?? 0)}
      onPress={onPress}
      hitSlop={space.s2}
      style={styles.action}
    >
      <Icon name="bell" size={size.icon} color={theme.text.primary} />
      {badge ? <Pill label={badge} tone="accent" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s1,
  },
});
