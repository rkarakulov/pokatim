import { t } from '@pokatim/i18n';
import { textStyle } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { useSvgLib } from '@/features/routes/use-svg-native';
import { useAppTheme } from '@/theme/use-app-theme';

import { qrMatrix } from './qr-matrix';
import type { TicketQrProps } from './ticket-qr-props';

/**
 * QR билета на native (RC-B5): `react-native-svg` лениво (`useSvgLib`, правило `pokatim-app.md`) — `Path` тёмных
 * модулей на «бумаге» `ticket.qrPaper` (светлая во всех темах). Модуля в сборке нет (старый dev-клиент) — «Обновите
 * приложение»: код билета под QR достаточен для ручной отметки. Пока модуль грузится — пустая «бумага» той же стороны.
 * Содержимое QR не попадает ни в подписи a11y, ни в журнал.
 */
export function TicketQr({ payload, size }: TicketQrProps) {
  const { colors } = useAppTheme();
  const lib = useSvgLib();
  if (lib === false) {
    return (
      <Text style={[textStyle('body'), { color: colors.text.secondary }]}>
        {t('tickets.updateApp')}
      </Text>
    );
  }
  const matrix = qrMatrix(payload);
  return (
    <View
      testID="ticket-qr"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('tickets.qrLabel')}
      style={[styles.paper, { width: size, height: size, backgroundColor: colors.ticket.qrPaper }]}
    >
      {lib ? (
        <lib.Svg viewBox={`0 0 ${matrix.size} ${matrix.size}`} width={size} height={size}>
          <lib.Path d={matrix.path} fill={colors.ticket.qrInk} />
        </lib.Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { alignSelf: 'center' },
});
