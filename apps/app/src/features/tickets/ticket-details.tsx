import type { TicketView } from '@pokatim/contracts';
import { formatTicketCode } from '@pokatim/contracts';
import { layout, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Kicker, Pill, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { EventMaterials } from '@/components/event-materials';
import { DetailRow } from '@/features/routes/detail-row';

import { TicketActions } from './ticket-actions';
import {
  qrUnavailableText,
  spelledCode,
  ticketCategory,
  ticketDateLine,
  ticketKindLabel,
  ticketStatus,
} from './ticket-format';
import { TicketQr } from './ticket-qr';

/** Слот PR E (Wallet): в `TicketView` поля ещё нет — ничего не рендерит; PR E добавит поле ответа и наполнит слот. */
const TicketWalletSlot = (_props: { view: TicketView }) => null;

/**
 * Билет (plan-B §2): тип и событие, статус, дата и время (Минск, с годом), место и адрес, участник, группа или
 * дистанция, QR и код крупно (или пояснение, почему QR нет), инструкции организатора, действия, материалы события
 * (`materials` — PR C; старый сервер поля не шлёт — блока нет). Чистое представление — общее для ответа сервера и
 * офлайн-копии (материалы входят в копию вместе с `TicketView`).
 */
export function TicketDetails({ view }: { view: TicketView }) {
  const theme = useTheme();
  const kind = ticketKindLabel(view.event.kind);
  const status = ticketStatus(view);
  const category = ticketCategory(view.category);
  const code = formatTicketCode(view.code);

  return (
    <View testID="ticket-details" style={styles.details}>
      <View style={styles.head}>
        {kind ? <Kicker label={kind} /> : null}
        <Text
          accessibilityRole="header"
          style={[textStyle('displaySm'), { color: theme.text.primary }]}
        >
          {view.event.title}
        </Text>
        {status ? (
          <View style={styles.start}>
            <Pill label={status.label} tone={status.tone} />
          </View>
        ) : null}
      </View>

      <View style={styles.qrBlock}>
        {view.qr ? (
          <>
            <TicketQr payload={view.qr} size={layout.ticketQr} />
            <Text style={[textStyle('meta'), styles.center, { color: theme.text.secondary }]}>
              {t('tickets.qrHint')}
            </Text>
          </>
        ) : (
          <Text style={[textStyle('body'), styles.center, { color: theme.text.secondary }]}>
            {qrUnavailableText(view)}
          </Text>
        )}
        <Text style={[textStyle('label'), styles.center, { color: theme.text.secondary }]}>
          {t('tickets.code')}
        </Text>
        <Text
          selectable
          accessibilityLabel={t('tickets.codeLabel', { code: spelledCode(view.code) })}
          style={[textStyle('displaySm'), styles.center, { color: theme.text.primary }]}
        >
          {code}
        </Text>
      </View>

      <View style={styles.rows}>
        <DetailRow label={t('tickets.when')}>{ticketDateLine(view.event)}</DetailRow>
        {view.event.place ? (
          <DetailRow label={t('tickets.place')}>{view.event.place}</DetailRow>
        ) : null}
        {view.event.address || view.event.city ? (
          <DetailRow label={t('tickets.address')}>
            {[view.event.address, view.event.city].filter(Boolean).join(', ')}
          </DetailRow>
        ) : null}
        <DetailRow label={t('tickets.participant')}>{view.participantName}</DetailRow>
        {category ? <DetailRow label={category.label}>{category.value}</DetailRow> : null}
      </View>

      {view.instructions ? (
        <View style={styles.rows}>
          <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
            {t('tickets.instructions')}
          </Text>
          <Text selectable style={[textStyle('body'), { color: theme.text.primary }]}>
            {view.instructions}
          </Text>
        </View>
      ) : null}

      <TicketActions event={view.event} />
      <EventMaterials materials={view.materials ?? []} />
      <TicketWalletSlot view={view} />
    </View>
  );
}

const styles = StyleSheet.create({
  details: { gap: space.s5 },
  head: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
  qrBlock: { gap: space.s2, alignItems: 'center' },
  center: { textAlign: 'center' },
  rows: { gap: space.s3 },
});
