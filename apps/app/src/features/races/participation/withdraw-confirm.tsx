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
 * закрывается. На время запроса обе кнопки выключены. Тексты по умолчанию — отмены участия; `texts` — то же
 * подтверждение для другого необратимого действия («Отозвать спор?», race-results-06).
 */
export function WithdrawConfirm({
  pending,
  onConfirm,
  onClose,
  texts,
}: {
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  texts?: { title: string; body: string; confirm: string; keep: string };
}) {
  const theme = useTheme();
  const { title, body, confirm, keep } = texts ?? {
    title: t('races.entry.withdrawTitle'),
    body: t('races.entry.withdrawBody'),
    confirm: t('races.entry.withdrawConfirm'),
    keep: t('races.entry.keep'),
  };
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
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>{body}</Text>
      <View style={styles.start}>
        <TextAction label={confirm} destructive disabled={pending} onPress={onConfirm} />
      </View>
      <Button label={keep} variant="secondary" disabled={pending} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.s3, padding: space.s4, borderWidth: stroke.hairline },
  start: { alignItems: 'flex-start' },
});
