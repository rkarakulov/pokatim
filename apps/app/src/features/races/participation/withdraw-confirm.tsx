import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { raceActionErrorText } from '../participation-format';
import { useWithdrawFromRace } from '../queries';

/**
 * Инлайн-подтверждение «Отменить участие?» (§7.4; одинаково на всех платформах, не модалка): последствия C1/H2,
 * destructive «Отменить участие» и «Оставить участие». На время запроса обе кнопки выключены; успех — блок покажет
 * `withdrawn` из ответа сервера; отказ — текст под кнопками.
 */
export function WithdrawConfirm({ raceId, onClose }: { raceId: string; onClose: () => void }) {
  const theme = useTheme();
  const withdraw = useWithdrawFromRace(raceId);
  const title = t('races.entry.withdrawTitle');

  return (
    <View style={[styles.panel, { borderColor: theme.border.strong }]}>
      <Text
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
          disabled={withdraw.isPending}
          onPress={() => withdraw.mutate(undefined, { onSuccess: onClose })}
        />
      </View>
      <Button
        label={t('races.entry.keep')}
        variant="secondary"
        disabled={withdraw.isPending}
        onPress={onClose}
      />
      {withdraw.error ? (
        <Banner tone="error" message={raceActionErrorText(withdraw.error)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.s3, padding: space.s4, borderWidth: stroke.hairline },
  start: { alignItems: 'flex-start' },
});
