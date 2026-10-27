import type { NotificationView } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { minskDateTime } from '@/lib/minsk-format';

/** «14 июня, 10:00» по Минску (год — только не текущий). */
function createdLabel(iso: string, now: Date): string {
  const { date, time } = minskDateTime(iso, now);
  return t('format.dateTime', { date, time });
}

interface NotificationRowProps {
  notification: NotificationView;
  now: Date;
  onPress: () => void;
}

/**
 * Строка центра: заголовок и текст снимка сервера, время по Минску; непрочитанное — `Pill` «Новое». Вся строка —
 * кнопка (прочитать и перейти к объекту, N9–N10).
 */
export function NotificationRow({ notification, now, onPress }: NotificationRowProps) {
  const theme = useTheme();
  const date = createdLabel(notification.createdAt, now);
  const label = t(notification.read ? 'notifications.rowRead' : 'notifications.rowUnread', {
    title: notification.title,
    body: notification.body,
    date,
  });
  return (
    <Pressable
      testID={`notification-${notification.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <View style={styles.head}>
        <Text
          style={[
            textStyle(notification.read ? 'titleSmRead' : 'titleSm'),
            styles.title,
            { color: theme.text.primary },
          ]}
        >
          {notification.title}
        </Text>
        {notification.read ? null : <Pill label={t('notifications.unread')} tone="accent" />}
      </View>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>{notification.body}</Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{date}</Text>
    </Pressable>
  );
}

/** Скелетон строки: заголовок, две строки текста, время. */
export function NotificationRowSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: theme.border.subtle }]}>
      <SkeletonText variant="titleSm" lastLineWidth="50%" />
      <SkeletonText variant="body" lines={2} lastLineWidth="70%" />
      <SkeletonText variant="meta" lastLineWidth="30%" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.s4,
    gap: space.s1,
    borderTopWidth: stroke.hairline,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  title: { flexShrink: 1 },
});
