import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';

import { focusForAccessibility } from '@/lib/accessibility-focus';

/**
 * Инлайн-подтверждение «Отменить участие?» (§7.4; одинаково на всех платформах, не модалка): последствия C1/H2,
 * destructive «Отменить участие» и «Оставить участие»; при появлении фокус скринридера — на заголовке. Мутация и её
 * отказ — у владельца (`EntryActions`): текст отказа остаётся, даже когда сервер уже не даёт отменить и панель
 * закрывается. На время запроса обе кнопки выключены.
 */
export function WithdrawConfirm({
  pending,
  onConfirm,
  onClose,
}: {
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const title = t('races.entry.withdrawTitle');
  const heading = useRef<HostInstance>(null);

  useEffect(() => {
    focusForAccessibility(heading.current);
  }, []);

  return (
    <View style={[styles.panel, { borderColor: theme.border.strong }]}>
      <Text
        ref={heading}
        accessibilityRole="header"
        accessibilityLabel={title}
        style={[textStyle('titleSm'), { color: theme.text.primary }]}
      >
        {title}
      </Text>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {t('races.entry.withdrawBody')}
      </Text>
      <View style={styles.start}>
        <TextAction
          label={t('races.entry.withdrawConfirm')}
          destructive
          disabled={pending}
          onPress={onConfirm}
        />
      </View>
      <Button
        label={t('races.entry.keep')}
        variant="secondary"
        disabled={pending}
        onPress={onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.s3, padding: space.s4, borderWidth: stroke.hairline },
  start: { alignItems: 'flex-start' },
});
