import { size, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

interface SettingsRowProps {
  label: string;
  /** текущее значение справа («Русский», «1.0.0», адрес поддержки) — входит в подпись a11y */
  value?: string;
  /** нет — строка только для чтения (версия) */
  onPress?: () => void;
  /** есть — строка выбора (`radio`): галочка у выбранной вместо шеврона */
  selected?: boolean;
}

/**
 * Строка экранов настроек (`.lrow` прототипа: hairline сверху, без коробок): название, значение, шеврон перехода или
 * галочка выбора. Для скринридера — одна ссылка / радио «название, значение». Кандидат в `@rkarakulov/ui`.
 */
export function SettingsRow({ label, value, onPress, selected }: SettingsRowProps) {
  const theme = useTheme();
  const choice = selected !== undefined;
  const a11yLabel = value ? `${label}, ${value}` : label;
  const content = (
    <>
      <Text style={[textStyle('body'), styles.label, { color: theme.text.primary }]}>{label}</Text>
      {value ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{value}</Text>
      ) : null}
      {choice ? (
        <View style={styles.mark}>
          {selected ? <Icon name="check" size={size.icon} color={theme.text.primary} /> : null}
        </View>
      ) : onPress ? (
        <Icon name="chevronRight" size={size.icon} color={theme.text.secondary} />
      ) : null}
    </>
  );
  const rowStyle = [styles.row, { borderTopColor: theme.border.subtle }];

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11yLabel} style={rowStyle}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={choice ? 'radio' : 'link'}
      accessibilityLabel={a11yLabel}
      // `aria-checked`, как у `Checkbox` базы: `accessibilityState` в RN-web не даёт состояния радио
      aria-checked={choice ? selected : undefined}
      onPress={onPress}
      style={rowStyle}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    minHeight: size.touchMin,
    paddingVertical: space.s3,
    borderTopWidth: stroke.hairline,
  },
  label: { flex: 1 },
  mark: { width: size.icon, alignItems: 'center' },
});
