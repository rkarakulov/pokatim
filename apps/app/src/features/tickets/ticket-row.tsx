import type { MyTicketRef } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ticketKindLabel, ticketShortDate, ticketStatus } from './ticket-format';

/**
 * Строка билета («Ваши билеты» на Главной): событие, тип и дата (Минск, с годом), статус. Для скринридера — одна ссылка
 * «событие. дата. статус».
 */
export function TicketRow({ ticket, onPress }: { ticket: MyTicketRef; onPress: () => void }) {
  const theme = useTheme();
  const date = ticketShortDate(ticket.event.startsAt);
  const kind = ticketKindLabel(ticket.event.kind);
  const status = ticketStatus(ticket);
  const line = [kind, date].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('tickets.row', {
        event: ticket.event.title,
        date,
        status: status?.label ?? '',
      })}
      onPress={onPress}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <View style={styles.main}>
        <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
          {ticket.event.title}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{line}</Text>
      </View>
      {status ? <Pill label={status.label} tone={status.tone} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    minHeight: size.rowMin,
    paddingVertical: space.s3,
    borderTopWidth: stroke.hairline,
  },
  main: { flex: 1, gap: space.s1 },
});
