import type { PanelDisputeSeriesData } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { formatKmFromMeters, formatKmPrecise } from '../../format';
import { Button, ErrorState } from '../../ui';
import { disputeSeriesQuery } from './disputes-query';
import { formatValue, SeriesChart, type SeriesKind } from './SeriesChart';

/** Опрос «готовится»: каждые 2 с, не дольше 3 мин по часам (дальше — «Повторить»). */
export const SERIES_POLL_MS = 2_000;
export const SERIES_POLL_MAX_MS = 3 * 60_000;

function summaryText(kind: SeriesKind, data: PanelDisputeSeriesData): string {
  const { summary } = data;
  const unit = t(`admin.disputes.series.unit.${kind}`);
  if (kind === 'speed') {
    return t('admin.disputes.series.summarySpeed', {
      avg: formatValue(summary.avgSpeedKmh, kind).replace(` ${unit}`, ''),
      unit,
    });
  }
  const [avg, max] =
    kind === 'heartRate'
      ? [summary.avgHeartRate, summary.maxHeartRate]
      : [summary.avgPower, summary.maxPower];
  return t('admin.disputes.series.summary', {
    avg: String(avg ?? '—'),
    max: String(max ?? '—'),
    unit,
  });
}

const SERIES: {
  kind: SeriesKind;
  values: (data: PanelDisputeSeriesData) => (number | null)[] | null;
}[] = [
  { kind: 'heartRate', values: (data) => data.heartRate },
  { kind: 'power', values: (data) => data.power },
  { kind: 'speed', values: (data) => data.speedKmh },
];

/** Три графика по общей оси дистанции, перекрестие — общее; таблица значений — текстовая альтернатива. */
function Charts({ data }: { data: PanelDisputeSeriesData }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.distanceM.length === 0) {
    return <p className="t-body">{t('admin.disputes.series.empty')}</p>;
  }
  const total = data.distanceM.at(-1)!;
  // ряд без единого значения в таблице не нужен — над графиками уже сказано «Нет данных»
  const columns = SERIES.flatMap(({ kind, values }) => {
    const series = values(data);
    return series?.some((value) => value !== null) ? [{ kind, values: series }] : [];
  });
  return (
    <div className="series">
      <p className="t-meta muted">
        {t('admin.disputes.series.segment', {
          distance: formatKmFromMeters(data.segmentDistanceM),
        })}
        {' · '}
        {t('admin.disputes.series.hint')}
      </p>
      {SERIES.map(({ kind, values }) => {
        const series = values(data);
        return series ? (
          <SeriesChart
            key={kind}
            kind={kind}
            distanceM={data.distanceM}
            values={series}
            summary={summaryText(kind, data)}
            hover={hover}
            onHover={setHover}
          />
        ) : (
          <p key={kind} className="series__missing t-body">
            {t(`admin.disputes.series.noData.${kind as 'heartRate' | 'power'}`)}
          </p>
        );
      })}
      <div className="series__axis t-meta" aria-hidden="true">
        <span>{formatKmFromMeters(0)}</span>
        <span>{t('admin.disputes.series.axis')}</span>
        <span>{formatKmFromMeters(total)}</span>
      </div>
      <details className="series__table">
        <summary className="link t-body">{t('admin.disputes.series.table')}</summary>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('admin.disputes.series.column.distance')}</th>
              {columns.map(({ kind }) => (
                <th key={kind} scope="col">
                  {t(`admin.disputes.series.${kind}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.distanceM.map((distance, k) => (
              <tr key={distance}>
                <td>{formatKmPrecise(distance)}</td>
                {columns.map(({ kind, values }) => (
                  <td key={kind}>{formatValue(values[k] ?? null, kind)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Запрос рядов после нажатия: «готовится» (опрос) → графики | причина | ошибка с повтором. */
function SeriesBody({ disputeId }: { disputeId: string }) {
  const [since, setSince] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const query = useQuery({
    ...disputeSeriesQuery(disputeId),
    refetchInterval: (state) =>
      state.state.data?.state === 'preparing' && Date.now() - since < SERIES_POLL_MAX_MS
        ? SERIES_POLL_MS
        : false,
  });
  useEffect(() => {
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(since + SERIES_POLL_MAX_MS - Date.now(), 0),
    );
    return () => clearTimeout(timer);
  }, [since]);
  const retry = () => {
    setSince(Date.now());
    setExpired(false);
    void query.refetch();
  };

  const data = query.data;
  if (!data) {
    if (query.isError || query.fetchStatus === 'paused') {
      return (
        <ErrorState
          error={query.error}
          offline={query.fetchStatus === 'paused'}
          onRetry={() => void query.refetch()}
        />
      );
    }
    return (
      <p className="t-body" role="status">
        {t('admin.disputes.series.preparing')}
      </p>
    );
  }
  if (data.state === 'preparing') {
    return expired ? (
      <div className="state" role="alert">
        <p className="t-body">{t('admin.disputes.series.timeout')}</p>
        <div className="state__actions">
          <Button onClick={retry}>{t('admin.disputes.series.retry')}</Button>
        </div>
      </div>
    ) : (
      <p className="t-body" role="status">
        {t('admin.disputes.series.preparing')}
      </p>
    );
  }
  if (data.state === 'unavailable') {
    return (
      <div className="state" role="status">
        <p className="t-body">{t(`admin.disputes.series.unavailable.${data.reason}`)}</p>
        {data.reason === 'failed' ? (
          <div className="state__actions">
            <Button onClick={retry}>{t('admin.disputes.series.retry')}</Button>
          </div>
        ) : null}
      </div>
    );
  }
  return <Charts data={data.series} />;
}

/**
 * Блок «Пульс и мощность» разбора спора (race-results-06b, `disputes.read`): биометрия оспоренного результата
 * запрашивается только по кнопке — ряды строит worker из исходника, сервер их не хранит.
 */
export function DisputeSeries({ disputeId }: { disputeId: string }) {
  const titleId = useId();
  const [requested, setRequested] = useState(false);
  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.disputes.series.title')}
      </h2>
      <p className="page-note t-meta">{t('admin.disputes.series.note')}</p>
      {requested ? (
        <SeriesBody disputeId={disputeId} />
      ) : (
        <Button onClick={() => setRequested(true)}>{t('admin.disputes.series.show')}</Button>
      )}
    </section>
  );
}
