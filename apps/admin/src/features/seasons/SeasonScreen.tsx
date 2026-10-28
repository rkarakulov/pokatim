import type { PanelSeasonStandingsSummary } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import { formatDateTimeLong, formatLocalDate } from '../../format';
import { httpStatus, isForbidden } from '../../session/errors';
import { DataTable, EmptyState, ErrorState, PageHeader, StatusTag } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { seasonsQuery } from './seasons-query';
import { SeasonStandingsTable, STANDINGS_BASE_COLUMNS } from './SeasonStandingsTable';
import { seasonStandingsQuery } from './standings-query';

const SYNC_TONE = { current: 'success', pending: 'ink' } as const;

/** Время пересчёта, версия формулы и свежесть снимка («Актуален» / «Ждёт пересчёта», RC-14). */
function SnapshotLine({ summary }: { summary: PanelSeasonStandingsSummary }) {
  return (
    <p className="page-note t-meta">
      <StatusTag tone={SYNC_TONE[summary.sync]}>
        {t(`admin.standings.sync.${summary.sync}`)}
      </StatusTag>{' '}
      <span>
        {summary.computedAt === null
          ? t('admin.standings.neverComputed')
          : t('admin.standings.computedAt', { date: formatDateTimeLong(summary.computedAt) })}
      </span>
      {summary.formulaVersion === null ? null : (
        <>
          {' · '}
          <span>{t('admin.standings.formula', { version: summary.formulaVersion })}</span>
        </>
      )}
    </p>
  );
}

/**
 * Экран сезона панели `/seasons/:id` (`races.read`, race-results-08b): шапка — название и даты из «Сезонов», раздел
 * «Рейтинг» без компонента вкладок (RC-19). Только чтение: таблицы, места и очки считает сервер. Состояния — скелетон
 * под шапкой, 403 — «Нет доступа», 404 — «Сезон не найден», ошибка — с повтором, таблиц нет — пустое состояние.
 */
export function SeasonScreen({ seasonId }: { seasonId: string }) {
  const titleId = useId();
  const seasons = useQuery(seasonsQuery);
  const season = seasons.data?.find((item) => item.id === seasonId);
  const summary = useQuery(seasonStandingsQuery(seasonId));

  if (summary.isError && !summary.data && isForbidden(summary.error)) return <NoAccessScreen />;

  const header = (
    <PageHeader
      crumb={
        <Link className="link" to="/seasons">
          {t('admin.seasons.title')}
        </Link>
      }
      title={season?.name ?? t('admin.seasons.title')}
      meta={
        season
          ? t('admin.seasons.range', {
              from: formatLocalDate(season.startsOn),
              to: formatLocalDate(season.endsOn),
            })
          : undefined
      }
    />
  );

  if (summary.isError && !summary.data && httpStatus(summary.error) === 404) {
    return (
      <>
        {header}
        <div className="page-body">
          <EmptyState title={t('admin.seasons.notFound')} />
        </div>
      </>
    );
  }

  const data = summary.data;
  const [first, ...rest] = data?.tables ?? [];
  let body;
  if (data) {
    body = (
      <>
        <SnapshotLine summary={data} />
        {first ? (
          <SeasonStandingsTable seasonId={seasonId} tables={[first, ...rest]} />
        ) : (
          <EmptyState title={t('admin.standings.empty')}>
            {t('admin.standings.emptyHint')}
          </EmptyState>
        )}
      </>
    );
  } else if (summary.isError || summary.fetchStatus === 'paused') {
    body = (
      <ErrorState
        error={summary.error}
        offline={summary.fetchStatus === 'paused'}
        onRetry={() => void summary.refetch()}
      />
    );
  } else {
    // сводка грузится — раскладка таблицы скелетоном
    body = (
      <DataTable
        caption={t('admin.standings.title')}
        columns={STANDINGS_BASE_COLUMNS}
        query={{ data: undefined, isError: false, error: null, refetch: () => summary.refetch() }}
        empty={null}
      />
    );
  }

  return (
    <>
      {header}
      <div className="page-body">
        <section className="section" aria-labelledby={titleId}>
          <h2 id={titleId} className="section__title t-label">
            {t('admin.standings.title')}
          </h2>
          {body}
        </section>
      </div>
    </>
  );
}
