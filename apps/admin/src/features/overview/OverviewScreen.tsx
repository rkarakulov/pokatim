import type {
  PanelOverview,
  PanelOverviewCalendarStart,
  PanelOverviewRace,
  Permission,
} from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Link, type LinkProps } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';

import { formatDateTime, formatLocalDate } from '../../format';
import { useCan } from '../../session/can';
import { useMe } from '../../session/me';
import { Banner, Button, DataTable, EmptyState, ErrorState, PageHeader, StatTile } from '../../ui';
import { overviewQuery } from './overview-query';

type Attention = PanelOverview['attention'];

/** Карточка «Требует внимания»: право (скелетон до ответа), число, подсказка и раздел. Ноль — «Всё разобрано». */
interface AttentionCard {
  key: string;
  permission: Permission;
  label: MessageKey;
  value: (attention: Attention) => number | undefined;
  hint?: (attention: Attention) => ReactNode;
  to?: LinkProps['to'];
  /** Вкладка раздела, где живёт очередь карточки. */
  search?: { tab: 'reported' };
}

const ATTENTION_CARDS: readonly AttentionCard[] = [
  {
    key: 'disputes',
    permission: 'disputes.read',
    label: 'admin.overview.card.disputes',
    value: (a) => a.disputes?.open,
    to: '/disputes',
  },
  {
    key: 'protocols',
    permission: 'races.read',
    label: 'admin.overview.card.protocols',
    value: (a) => a.protocols?.awaiting,
    hint: (a) =>
      a.protocols
        ? t(
            a.protocols.checked < a.protocols.awaiting
              ? 'admin.overview.card.protocolsHintPartial'
              : 'admin.overview.card.protocolsHint',
            {
              ready: String(a.protocols.ready),
              blockers: String(a.protocols.blockers),
              checked: String(a.protocols.checked),
            },
          )
        : null,
    to: '/races',
  },
  {
    key: 'rides',
    permission: 'rides.moderate',
    label: 'admin.overview.card.rides',
    value: (a) => a.rides?.reported,
    to: '/rides-moderation',
  },
  {
    key: 'riderRoutesPending',
    permission: 'routes.moderate',
    label: 'admin.overview.card.riderRoutesPending',
    value: (a) => a.riderRoutes?.pending,
    to: '/rider-routes',
  },
  {
    key: 'riderRoutesReported',
    permission: 'routes.moderate',
    label: 'admin.overview.card.riderRoutesReported',
    value: (a) => a.riderRoutes?.reported,
    to: '/rider-routes',
    search: { tab: 'reported' },
  },
  {
    key: 'riderProfiles',
    permission: 'profiles.moderate',
    label: 'admin.overview.card.riderProfiles',
    value: (a) => a.riderProfiles?.reported,
    to: '/rider-profiles',
  },
  {
    key: 'accountDeletions',
    permission: 'platform.stats',
    label: 'admin.overview.card.accountDeletions',
    value: (a) => a.accountDeletions?.stuck,
    hint: () => t('admin.overview.card.accountDeletionsHint'),
    to: '/account-erasures',
  },
];

function cardHint(card: AttentionCard, attention: Attention, value: number): ReactNode {
  if (value === 0) return t('admin.overview.calm');
  return (
    <>
      {card.hint?.(attention)}
      {card.hint && card.to ? <br /> : null}
      {card.to ? (
        <Link className="link" to={card.to} search={card.search}>
          {t('admin.overview.open')}
        </Link>
      ) : null}
    </>
  );
}

/**
 * «Требует внимания»: до ответа — скелетоны карточек по правам сотрудника (раскладка успешного состояния); после —
 * только карточки, которые отдал сервер (нет права — нет поля).
 */
function AttentionSection({ attention }: { attention: Attention | undefined }) {
  const titleId = useId();
  const permissions = useMe()?.permissions ?? [];
  const cards = ATTENTION_CARDS.filter((card) =>
    attention ? card.value(attention) !== undefined : permissions.includes(card.permission),
  );
  if (cards.length === 0) return null;
  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.overview.attention')}
      </h2>
      <div className="stat-tiles stat-tiles--4">
        {cards.map((card) => {
          const value = attention ? card.value(attention) : undefined;
          return (
            <StatTile
              key={card.key}
              label={t(card.label)}
              value={value}
              hint={attention && value !== undefined ? cardHint(card, attention, value) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

const raceColumn = createColumnHelper<PanelOverviewRace>();
const RACE_COLUMNS = [
  raceColumn.accessor('title', {
    header: () => t('admin.overview.race'),
    cell: (info) => (
      <Link className="link" to="/races/$raceId/results" params={{ raceId: info.row.original.id }}>
        {info.getValue()}
      </Link>
    ),
  }),
  raceColumn.accessor('windowEndsAt', {
    header: () => t('admin.overview.windowEndsAt'),
    cell: (info) => formatDateTime(info.getValue()),
  }),
  raceColumn.accessor('participants', { header: () => t('admin.overview.participants') }),
  raceColumn.accessor('attempts', { header: () => t('admin.overview.attempts') }),
];

const startColumn = createColumnHelper<PanelOverviewCalendarStart>();
const START_COLUMNS = [
  startColumn.accessor('title', { header: () => t('admin.overview.start') }),
  startColumn.accessor('startsOn', {
    header: () => t('admin.overview.startsOn'),
    cell: (info) => {
      const { startsOn, endsOn } = info.row.original;
      return endsOn
        ? `${formatLocalDate(startsOn)} — ${formatLocalDate(endsOn)}`
        : formatLocalDate(startsOn);
    },
  }),
  startColumn.accessor('city', { header: () => t('admin.overview.city') }),
];

/** Таблица блока: ошибку показывает экран целиком, здесь — только загрузка, данные и пусто. */
const sectionQuery = <T,>(data: T[] | undefined) => ({
  data,
  isError: false,
  error: null,
  refetch: () => undefined,
});

/** «Сейчас идёт» (`races.read`): гонки с открытым окном (организатор — свои) и ближайшие старты календаря. */
function LiveSection({ live }: { live: PanelOverview['live'] | undefined }) {
  const titleId = useId();
  const shown = live?.races.length ?? 0;
  return (
    <section className="section overview-live" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.overview.live')}
      </h2>
      <h3 className="t-title-sm">{t('admin.overview.races')}</h3>
      <DataTable
        caption={t('admin.overview.races')}
        columns={RACE_COLUMNS}
        query={sectionQuery(live?.races)}
        empty={<EmptyState title={t('admin.overview.racesEmpty')} />}
        getRowId={(row) => row.id}
        footer={
          live && live.racesTotal > shown ? (
            <p className="muted t-meta">
              {t('admin.overview.racesMore', {
                shown: String(shown),
                total: String(live.racesTotal),
              })}
            </p>
          ) : undefined
        }
      />
      <h3 className="t-title-sm">{t('admin.overview.calendar')}</h3>
      <DataTable
        caption={t('admin.overview.calendar')}
        columns={START_COLUMNS}
        query={sectionQuery(live?.calendar)}
        empty={<EmptyState title={t('admin.overview.calendarEmpty')} />}
        getRowId={(row) => row.id}
      />
    </section>
  );
}

/** KPI платформы (`platform.stats`, только admin) — полоса плиток, как KPI strip прототипа. */
function KpiSection({ kpi }: { kpi: PanelOverview['kpi'] | undefined }) {
  const titleId = useId();
  const week = t('admin.overview.kpi.week');
  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.overview.kpi')}
      </h2>
      <div className="stat-tiles stat-tiles--4">
        <StatTile label={t('admin.overview.kpi.newUsers')} value={kpi?.newUsers} hint={week} />
        <StatTile label={t('admin.overview.kpi.uploads')} value={kpi?.uploads} hint={week} />
        <StatTile
          label={t('admin.overview.kpi.activeRides')}
          value={kpi?.activeRides}
          hint={t('admin.overview.kpi.upcoming')}
        />
      </div>
    </section>
  );
}

/**
 * «Обзор» — общий для всех ролей (admin-overview): «Требует внимания», «Сейчас идёт», KPI (admin) и статус API
 * внизу. Один запрос `GET /v1/admin/overview`; блоки по правам решает сервер, клиент по правам сессии рисует только
 * скелетоны до ответа (AGENTS.md §4.12).
 */
export function OverviewScreen() {
  const overview = useQuery(overviewQuery());
  const canRaces = useCan('races.read');
  const canStats = useCan('platform.stats');
  const data = overview.data;
  const paused = overview.fetchStatus === 'paused';
  const retry = () => void overview.refetch();
  const me = useMe();

  return (
    <>
      <PageHeader title={t('admin.overview.title')} meta={t('admin.timezone')} />
      <div className="page-body">
        {me && !me.user.totp.enabled ? (
          <Banner
            tone="warning"
            title={t('admin.overview.totpBannerTitle')}
            actions={
              <Link to="/account/security" className="link t-meta">
                {t('admin.overview.totpBannerLink')}
              </Link>
            }
          >
            {t('admin.overview.totpBannerText')}
          </Banner>
        ) : null}
        {data && overview.isError ? (
          <Banner
            tone="error"
            role="alert"
            title={t('admin.overview.refreshFailed')}
            actions={
              <Button size="sm" onClick={retry}>
                {t('state.retry')}
              </Button>
            }
          >
            {t('admin.refreshFailedMessage')}
          </Banner>
        ) : null}
        {!data && (overview.isError || paused) ? (
          <ErrorState error={overview.error} offline={paused} onRetry={retry} />
        ) : (
          <>
            <AttentionSection attention={data?.attention} />
            {(data ? data.live : canRaces) ? <LiveSection live={data?.live} /> : null}
            {(data ? data.kpi : canStats) ? <KpiSection kpi={data?.kpi} /> : null}
          </>
        )}
      </div>
    </>
  );
}
