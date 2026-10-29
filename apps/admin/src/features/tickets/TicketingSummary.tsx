import type { TicketEventKind } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { httpStatus } from '../../session/errors';
import { Button } from '../../ui';
import { ticketingQuery } from './tickets-query';

/**
 * Компактный блок «Билеты» на странице гонки и в правой колонке календаря (RC-C1): «включены · N участников» или
 * «выключены» и ссылка на страницу «Билеты и материалы». Загрузка — скелетон строки; ошибка — строка с повтором;
 * 403/404 — блока нет (сервер не дал права или событие ещё черновик).
 */
export function TicketingSummary({ kind, eventId }: { kind: TicketEventKind; eventId: string }) {
  const query = useQuery(ticketingQuery(kind, eventId));
  const status = httpStatus(query.error);
  if (query.isError && (status === 403 || status === 404)) return null;
  const link =
    kind === 'race' ? (
      <Link className="link" to="/races/$raceId/tickets" params={{ raceId: eventId }}>
        {t('admin.tickets.summary.link')}
      </Link>
    ) : (
      <Link className="link" to="/calendar/$startId/tickets" params={{ startId: eventId }}>
        {t('admin.tickets.summary.link')}
      </Link>
    );
  let line;
  if (query.data) {
    line = query.data.enabled
      ? t('admin.tickets.summary.on', {
          count: kind === 'race' ? query.data.activeTickets : query.data.registeredCount,
        })
      : t('admin.tickets.summary.off');
  } else if (query.isError) {
    line = (
      <span role="alert">
        {t('admin.tickets.summary.failed')}{' '}
        <Button size="sm" onClick={() => void query.refetch()}>
          {t('state.retry')}
        </Button>
      </span>
    );
  } else {
    line = (
      <span className="skeleton" aria-busy="true" data-testid="ticketing-summary-skeleton">
        {' '}
      </span>
    );
  }
  return (
    <section className="form-group ticketing-summary" aria-label={t('admin.tickets.summary.title')}>
      <h2 className="form-group__title t-label">{t('admin.tickets.summary.title')}</h2>
      <p className="t-body">{line}</p>
      <p className="t-meta">{link}</p>
    </section>
  );
}
