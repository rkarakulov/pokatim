import type { PanelRaceResults } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { httpStatus, isForbidden } from '../../session/errors';
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  ReasonDialog,
  StatTile,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { raceQuery } from '../races/races-query';
import { AttemptsTable } from './AttemptsTable';
import { PublishBlock } from './PublishBlock';
import { RecalculationsList } from './RecalculationsList';
import { type ResultsDialog, useResultsAction } from './results-actions';
import { resultsErrorText } from './results-errors';
import { resultsSummaryQuery } from './results-query';
import { StandingsTable } from './StandingsTable';

/** Шесть плиток KPI (§7.9); «в зачёте» после публикации — строки протокола без DQ (RC-5). */
function Kpi({ summary }: { summary: PanelRaceResults | undefined }) {
  const titleId = useId();
  const attempts = summary?.counts.attempts;
  const tiles = [
    { key: 'active', value: summary?.counts.active },
    {
      key: 'ranked',
      value: summary ? (summary.protocol?.ranked ?? summary.counts.ranked) : undefined,
    },
    { key: 'checking', value: attempts ? attempts.queued + attempts.checking : undefined },
    { key: 'rejected', value: attempts?.rejected },
    { key: 'failed', value: summary?.counts.failed },
    { key: 'excluded', value: attempts?.excluded },
  ] as const;
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="visually-hidden">
        {t('admin.results.kpi.title')}
      </h2>
      <div className="stat-tiles">
        {tiles.map((tile) => (
          <StatTile key={tile.key} label={t(`admin.results.kpi.${tile.key}`)} value={tile.value} />
        ))}
      </div>
    </section>
  );
}

/**
 * Раздел «Результаты» гонки (`races.read`): KPI, протокол (чек-лист и публикация или экстренный пересчёт),
 * участники, попытки, история пересчётов. Всё считает сервер; действия — `ReasonDialog` с обязательной причиной,
 * затем обновление гонки и результатов. Права (`results.manage`, `results.revise`) только скрывают действия.
 */
export function RaceResultsScreen({ raceId }: { raceId: string }) {
  const race = useQuery(raceQuery(raceId));
  const summary = useQuery(resultsSummaryQuery(raceId));
  const run = useResultsAction(raceId);
  const [dialog, setDialog] = useState<ResultsDialog | null>(null);

  if (isForbidden(summary.error)) return <NoAccessScreen />;

  const title = race.data?.title;
  const header = (
    <PageHeader
      crumb={
        <>
          <Link className="link" to="/races">
            {t('admin.results.breadcrumb')}
          </Link>
          {' › '}
          {title ? (
            <Link className="link" to="/races/$raceId" params={{ raceId }}>
              {title}
            </Link>
          ) : null}
          {title ? ' › ' : null}
          {t('admin.results.title')}
        </>
      }
      title={
        title ?? (race.isError ? t('admin.results.title') : <span className="skeleton"> </span>)
      }
      meta={summary.data ? t(`domain.racePhase.${summary.data.phase}`) : t('admin.timezone')}
      actions={
        <Link className="button t-panel-button" to="/races/$raceId" params={{ raceId }}>
          {t('admin.results.backToRace')}
        </Link>
      }
    />
  );

  const data = summary.data;
  if (!data && (summary.isError || summary.fetchStatus === 'paused')) {
    return (
      <>
        {header}
        <div className="page-body">
          {httpStatus(summary.error) === 404 ? (
            <EmptyState title={t('admin.races.notFound')} />
          ) : (
            <ErrorState
              error={summary.error}
              offline={summary.fetchStatus === 'paused'}
              onRetry={() => void summary.refetch()}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="page-body">
        {data && summary.isError ? (
          <Banner
            tone="error"
            role="alert"
            title={t('admin.results.refreshFailed')}
            actions={
              <Button size="sm" onClick={() => void summary.refetch()}>
                {t('state.retry')}
              </Button>
            }
          >
            {t('admin.refreshFailedMessage')}
          </Banner>
        ) : null}
        <Kpi summary={data} />
        {data ? (
          <>
            <PublishBlock summary={data} run={run} open={setDialog} />
            <StandingsTable
              raceId={raceId}
              published={data.protocol !== null}
              run={run}
              open={setDialog}
            />
            <AttemptsTable summary={data} run={run} open={setDialog} />
            <RecalculationsList raceId={raceId} />
          </>
        ) : (
          <span role="progressbar" aria-label={t('state.loading')} className="visually-hidden" />
        )}
      </div>
      <ReasonDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        consequences={dialog?.consequences ?? ''}
        confirmLabel={dialog?.confirmLabel ?? ''}
        destructive={dialog?.destructive}
        errorText={resultsErrorText}
        onConfirm={async (reason) => {
          if (dialog) await dialog.run(reason);
        }}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
