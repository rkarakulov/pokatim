import type { TicketEventKind } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { api } from '../../api';
import { Can } from '../../session/can';
import { httpStatus, isForbidden } from '../../session/errors';
import { EmptyState, ErrorState, PageHeader, RefreshFailedBanner } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { raceQuery } from '../races/races-query';
import { MaterialsSection } from './MaterialsSection';
import { ParticipantsSection } from './ParticipantsSection';
import { TicketingSettingsForm } from './TicketingSettingsForm';
import { ticketingQuery } from './tickets-query';

const SKELETON_FIELDS = 4;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-group" aria-label={title}>
      <h2 className="form-group__title t-label">{title}</h2>
      {children}
    </section>
  );
}

/** Название и окно события для шапки и подсказки старта (гонка — карточка гонки, календарь — запись календаря). */
function useEventHead(kind: TicketEventKind, eventId: string) {
  const race = useQuery({ ...raceQuery(eventId), enabled: kind === 'race' });
  const start = useQuery({
    queryKey: ['admin', 'calendar', 'item', eventId],
    queryFn: () => api.getCalendarStart(eventId),
    enabled: kind === 'calendar',
  });
  if (kind === 'race') {
    return {
      title: race.data?.title,
      window: race.data
        ? { startsAt: race.data.windowStartsAt, endsAt: race.data.windowEndsAt }
        : undefined,
    };
  }
  return { title: start.data?.title, window: undefined };
}

/**
 * «Билеты и материалы» события (RC-C1): одна страница для гонки (`/races/:id/tickets`) и старта календаря
 * (`/calendar/:id/tickets`) — настройки билетов, материалы, участники (`tickets.checkin`). Право — по виду события на
 * сервере: 403 — «Нет доступа», 404 — «не найдено». Шапка видна сразу, секции — скелетон; сбой перечитывания при
 * загруженных настройках — баннер с повтором поверх них.
 */
export function EventTicketsScreen({ kind, eventId }: { kind: TicketEventKind; eventId: string }) {
  const settings = useQuery(ticketingQuery(kind, eventId));
  const head = useEventHead(kind, eventId);
  if (isForbidden(settings.error)) return <NoAccessScreen />;

  const crumb =
    kind === 'race' ? (
      <>
        <Link className="link" to="/races">
          {t('admin.races.title')}
        </Link>
        {head.title ? (
          <>
            {' › '}
            <Link className="link" to="/races/$raceId" params={{ raceId: eventId }}>
              {head.title}
            </Link>
          </>
        ) : null}
      </>
    ) : (
      <>
        <Link className="link" to="/calendar">
          {t('admin.calendar.title')}
        </Link>
        {head.title ? ` › ${head.title}` : null}
      </>
    );

  let body: ReactNode;
  if (settings.data) {
    body = (
      <>
        {settings.isError ? (
          <RefreshFailedBanner busy={settings.isFetching} onRetry={() => void settings.refetch()} />
        ) : null}
        <Section title={t('admin.tickets.section.settings')}>
          <TicketingSettingsForm
            key={settings.data.version}
            settings={settings.data}
            window={head.window}
          />
        </Section>
        <Section title={t('admin.tickets.section.materials')}>
          <MaterialsSection kind={kind} eventId={eventId} />
        </Section>
        <Can permission="tickets.checkin">
          <Section title={t('admin.tickets.section.participants')}>
            <ParticipantsSection kind={kind} eventId={eventId} />
          </Section>
        </Can>
      </>
    );
  } else if (settings.isError || settings.fetchStatus === 'paused') {
    body =
      httpStatus(settings.error) === 404 ? (
        <EmptyState title={t('admin.tickets.notFound')} />
      ) : (
        <ErrorState
          error={settings.error}
          offline={settings.fetchStatus === 'paused'}
          onRetry={() => void settings.refetch()}
        />
      );
  } else {
    body = (
      <div aria-busy="true">
        {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
          <div key={index} className="field" data-testid="skeleton-field">
            <span className="skeleton t-label"> </span>
            <span className="skeleton table__skeleton field__control"> </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader crumb={crumb} kicker={head.title} title={t('admin.tickets.title')} />
      <div className="page-body form-column">{body}</div>
    </>
  );
}
