import type { MyTicketRef } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { Button } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';

/** Билет можно открыть: есть и не отменён райдером (отменённое событие — открыть, там статус). */
export const canOpenTicket = (ticket: MyTicketRef | null | undefined): ticket is MyTicketRef =>
  ticket !== null && ticket !== undefined && ticket.status !== 'cancelled';

/** «Открыть билет» → `/tickets/<код>` («Ваше участие» гонки, регистрация на старт); билета нет — ничего. */
export function OpenTicketButton({ ticket }: { ticket: MyTicketRef | null | undefined }) {
  const router = useRouter();
  if (!canOpenTicket(ticket)) return null;
  return (
    <Button
      label={t('tickets.action.open')}
      variant="secondary"
      onPress={() => router.push(`/tickets/${ticket.code}` as Href)}
    />
  );
}
