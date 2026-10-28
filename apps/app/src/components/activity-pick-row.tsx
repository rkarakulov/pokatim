import { motion, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text } from 'react-native';

/**
 * Строка выбора своего заезда (гонка — `races/pick`, маршрут — `routes/pick`): заголовок-дата, мета (источник,
 * дистанция, время), примечание («Уже в гонке», «Уже проверен»). Только разметка: тексты и действие — у экрана.
 */
export function ActivityPickRow({
  title,
  details,
  note,
  disabled = false,
  busy = false,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  details: string;
  note?: string | null;
  /** заголовок приглушён, нажатие выключено */
  disabled?: boolean;
  /** идёт действие экрана — нажатие выключено, заголовок как обычно */
  busy?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: theme.border.subtle, opacity: pressed ? motion.pressedOpacity : 1 },
      ]}
    >
      <Text
        style={[
          textStyle('titleSm'),
          { color: disabled ? theme.text.disabled : theme.text.primary },
        ]}
      >
        {title}
      </Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{details}</Text>
      {note ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{note}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s1, paddingVertical: space.s3, borderTopWidth: stroke.hairline },
});
