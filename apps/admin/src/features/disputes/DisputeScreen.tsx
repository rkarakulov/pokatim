import type { PanelDispute } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';

import { api } from '../../api';
import { formatDateTimeLong, formatElapsed } from '../../format';
import { useCan } from '../../session/can';
import { httpStatus, isForbidden } from '../../session/errors';
import { EmptyState, ErrorState, PageHeader, ReadonlyField, StatusTag } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { raceItemKey } from '../results/results-query';
import { FlagList } from '../results/FlagList';
import { placeLabel, RESULT_TONE } from '../results/results-format';
import { DecisionPanel } from './DecisionPanel';
import { DisputeSeries } from './DisputeSeries';
import { DISPUTE_STATUS_TONE, disputeRiderLabel } from './disputes-format';
import { DISPUTES_QUERY_KEY, disputeQuery } from './disputes-query';

const SKELETON_FIELDS = 8;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id} className="section__title t-label">
        {title}
      </h2>
      <div className="form-column">{children}</div>
    </section>
  );
}

const statusTag = (status: PanelDispute['status']) => (
  <StatusTag tone={DISPUTE_STATUS_TONE[status]}>{t(`admin.disputes.status.${status}`)}</StatusTag>
);

function Review({ dispute }: { dispute: PanelDispute }) {
  const { target, decision } = dispute;
  return (
    <>
      <Section title={t('admin.disputes.result.title')}>
        <ReadonlyField
          label={t('admin.disputes.column.target')}
          value={disputeRiderLabel(target.entryId)}
        />
        <ReadonlyField
          label={t('admin.disputes.result.place')}
          value={placeLabel(target.place, target.tied)}
        />
        <ReadonlyField
          label={t('admin.disputes.result.time')}
          value={target.elapsedSec === null ? '—' : formatElapsed(target.elapsedSec)}
        />
        <ReadonlyField
          label={t('admin.disputes.result.status')}
          value={
            <StatusTag tone={RESULT_TONE[target.resultStatus]}>
              {t(`admin.results.resultStatus.${target.resultStatus}`)}
            </StatusTag>
          }
        />
        <ReadonlyField
          label={t('admin.disputes.result.group')}
          value={t(`results.group.${target.groupKey}`)}
        />
        <ReadonlyField
          label={t('admin.disputes.result.tier')}
          value={t(`results.tier.${target.tier}`)}
        />
        {/* race-results-07: живые флаги цели — сигнал для разбора, не решение */}
        <ReadonlyField
          label={t('admin.disputes.result.attention')}
          value={<FlagList flags={target.flags} />}
        />
      </Section>
      <Section title={t('admin.disputes.claim.title')}>
        <ReadonlyField
          label={t('admin.disputes.claim.complainant')}
          value={disputeRiderLabel(dispute.complainant.entryId)}
          help={t('admin.disputes.claim.hidden')}
        />
        <ReadonlyField
          label={t('admin.disputes.claim.category')}
          value={t(`admin.disputes.category.${dispute.category}`)}
        />
        <ReadonlyField
          label={t('admin.disputes.column.filedAt')}
          value={formatDateTimeLong(dispute.filedAt)}
        />
        <ReadonlyField
          label={t('admin.disputes.claim.description')}
          value={dispute.description ?? t('admin.disputes.claim.noDescription')}
        />
      </Section>
      <Section title={t('admin.disputes.response.title')}>
        {dispute.response ? (
          <ReadonlyField
            label={formatDateTimeLong(dispute.response.at)}
            value={dispute.response.text}
          />
        ) : (
          <p className="t-body">{t('admin.disputes.response.none')}</p>
        )}
      </Section>
      <Section title={t('admin.disputes.history.title')}>
        <ul className="checklist" aria-label={t('admin.disputes.history.title')}>
          {dispute.events.map((event, index) => (
            <li key={`${event.kind}-${index}`} className="checklist__item t-body">
              <time className="t-meta" dateTime={event.at}>
                {formatDateTimeLong(event.at)}
              </time>
              <span>{t(`admin.disputes.event.${event.kind}`)}</span>
            </li>
          ))}
        </ul>
      </Section>
      {decision ? (
        <Section title={t('admin.disputes.decision.title')}>
          <ReadonlyField
            label={t('admin.disputes.decision.outcome')}
            value={statusTag(decision.outcome)}
          />
          <ReadonlyField
            label={t('admin.disputes.decision.templateShown')}
            value={t(`admin.disputes.template.${decision.template}`)}
          />
          <ReadonlyField
            label={t('admin.disputes.decision.noteShown')}
            value={decision.note ?? t('admin.disputes.decision.noNote')}
          />
          <p className="page-note t-meta">
            {t('admin.disputes.decision.actor', {
              name: decision.actor.displayName,
              at: formatDateTimeLong(decision.at),
            })}
          </p>
        </Section>
      ) : null}
    </>
  );
}

/**
 * Разбор спора (`disputes.read`, race-results-06): оспоренный результат, заявление (заявитель скрыт от участника,
 * D-51), ответ участника, история; открытый спор с `disputes.decide` — панель решения. Решение инвалидирует споры,
 * гонку (результаты — под её ключом) и журнал. Пульс и мощность — блок `DisputeSeries` по кнопке (слайс 06b).
 */
export function DisputeScreen({ disputeId }: { disputeId: string }) {
  const queryClient = useQueryClient();
  const canDecide = useCan('disputes.decide');
  const dispute = useQuery(disputeQuery(disputeId));

  const crumbLink = (
    <Link className="link" to="/disputes">
      {t('admin.disputes.title')}
    </Link>
  );

  if (!dispute.data) {
    if (dispute.isError || dispute.fetchStatus === 'paused') {
      if (isForbidden(dispute.error)) return <NoAccessScreen />;
      return (
        <>
          <PageHeader crumb={crumbLink} title={t('admin.disputes.title')} />
          <div className="page-body">
            {httpStatus(dispute.error) === 404 ? (
              <EmptyState title={t('admin.disputes.notFound')} />
            ) : (
              <ErrorState
                error={dispute.error}
                offline={dispute.fetchStatus === 'paused'}
                onRetry={() => void dispute.refetch()}
              />
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <PageHeader crumb={crumbLink} title={<span className="skeleton"> </span>} />
        <div className="page-body form-column" aria-busy="true">
          {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
            <div key={index} className="field" data-testid="skeleton-field">
              <span className="skeleton t-label"> </span>
              <span className="skeleton table__skeleton field__control"> </span>
            </div>
          ))}
        </div>
      </>
    );
  }

  const data = dispute.data;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: DISPUTES_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: raceItemKey(data.race.id) });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  return (
    <>
      <PageHeader
        crumb={
          <>
            {crumbLink}
            {` › ${data.race.title}`}
          </>
        }
        title={t(`admin.disputes.category.${data.category}`)}
        actions={statusTag(data.status)}
      />
      <div className="page-body">
        <Review dispute={data} />
        <DisputeSeries disputeId={data.id} />
        {canDecide && data.status === 'open' ? (
          <DecisionPanel
            dispute={data}
            onDecide={async (body) => {
              // и при отказе (409: решил другой сотрудник, протокол, отмена) — разбор и гонка перечитываются
              try {
                const decided = await api.decideDispute(data.id, body);
                queryClient.setQueryData(disputeQuery(data.id).queryKey, decided);
              } finally {
                void refresh();
              }
            }}
          />
        ) : null}
      </div>
    </>
  );
}
