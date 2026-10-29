import { size, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
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
  /** слева от названия (превью темы) — декоративное, скрывается от скринридера самим элементом */
  leading?: ReactNode;
  /** строка под названием (описание темы) — подсказка a11y, в подпись не входит */
  description?: string;
}

/**
 * Строка экранов настроек (`.lrow` прототипа: hairline сверху, без коробок): [превью], название [и описание под ним],
 * значение, шеврон перехода или галочка выбора. Для скринридера — одна ссылка / радио «название, значение», описание —
 * подсказкой. Кандидат в `@rkarakulov/ui`.
 */
export function SettingsRow({
  label,
  value,
  onPress,
  selected,
  leading,
  description,
}: SettingsRowProps) {
  const theme = useTheme();
  const choice = selected !== undefined;
  const a11yLabel = value ? `${label}, ${value}` : label;
  const title = (
    <Text style={[textStyle('body'), styles.label, { color: theme.text.primary }]}>{label}</Text>
  );
  const content = (
    <>
      {leading}
      {description ? (
        <View style={styles.label}>
          {title}
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{description}</Text>
        </View>
      ) : (
        title
      )}
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
      <View
        accessible
        accessibilityLabel={a11yLabel}
        accessibilityHint={description}
        style={rowStyle}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={choice ? 'radio' : 'link'}
      accessibilityLabel={a11yLabel}
      accessibilityHint={description}
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
