import type { PanelRaceResults } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { useCan } from '../../session/can';
import { Banner, Button, DisabledReason, StatusTag } from '../../ui';
import type { OpenResultsDialog } from './results-actions';
import { publishBlockText } from './results-errors';

/**
 * Протокол гонки. До публикации — чек-лист сервера (D-23) и «Опубликовать протокол» (`results.manage`): неактивна с
 * первой причиной и количеством; «Требует внимания» не блокирует (D-22). После — баннер ревизии и экстренный
 * пересчёт (`results.revise`, D-27/D-28): перепроверка треков и «Применить пересчёт», пока проверки не завершены —
 * неактивна. Строка «Открытые споры» — ссылка на споры гонки (`disputes.read`, race-results-06).
 */
export function PublishBlock({
  summary,
  run,
  open,
}: {
  summary: PanelRaceResults;
  run: (call: () => Promise<unknown>) => Promise<void>;
  open: OpenResultsDialog;
}) {
  const canManage = useCan('results.manage');
  const canRevise = useCan('results.revise');
  const canReadDisputes = useCan('disputes.read');
  const publishReasonId = useId();
  const applyReasonId = useId();
  const { raceId, protocol, recheck, publish } = summary;
  const pendingChecks = recheck?.pending ?? 0;

  if (protocol) {
    const applyBlocked = pendingChecks > 0;
    return (
      <section className="section" aria-labelledby={`${publishReasonId}-title`}>
        <h2 id={`${publishReasonId}-title`} className="section__title t-label">
          {t('admin.results.revise.title')}
        </h2>
        <Banner
          title={t('admin.results.published', {
            date: formatDateTimeLong(protocol.publishedAt),
            revision: protocol.revision,
          })}
        >
          {protocol.recheckPending
            ? t('admin.results.recheckPending', { count: pendingChecks })
            : null}
        </Banner>
        {canRevise ? (
          <div className="form-actions">
            <Button
              onClick={() =>
                open({
                  title: t('admin.results.dialog.recheck'),
                  consequences: t('admin.results.dialog.protocolRecheckConsequences'),
                  confirmLabel: t('admin.results.action.recheck'),
                  run: (reason) => run(() => api.recheckProtocol(raceId, { reason })),
                })
              }
            >
              {t('admin.results.action.recheck')}
            </Button>
            {protocol.recheckPending ? (
              <>
                <Button
                  variant="primary"
                  aria-disabled={applyBlocked || undefined}
                  aria-describedby={applyBlocked ? applyReasonId : undefined}
                  onClick={() => {
                    if (applyBlocked) return;
                    const failed = summary.counts.failed;
                    open({
                      title: t('admin.results.dialog.apply'),
                      consequences: [
                        t('admin.results.dialog.applyConsequences'),
                        failed > 0 ? t('admin.results.dialog.applyFailed', { count: failed }) : '',
                      ]
                        .filter(Boolean)
                        .join(' '),
                      confirmLabel: t('admin.results.action.apply'),
                      run: (reason) => run(() => api.applyProtocolRecheck(raceId, { reason })),
                    });
                  }}
                >
                  {t('admin.results.action.apply')}
                </Button>
                {applyBlocked ? (
                  <DisabledReason id={applyReasonId}>
                    {t('admin.results.blocked.checks_pending', { count: pendingChecks })}
                  </DisabledReason>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  const blockText = publishBlockText(publish);
  const blocked = !publish.canPublish;
  return (
    <section className="section" aria-labelledby={`${publishReasonId}-title`}>
      <h2 id={`${publishReasonId}-title`} className="section__title t-label">
        {t('admin.results.publish.title')}
      </h2>
      {recheck && pendingChecks > 0 ? (
        <Banner>{t('admin.results.recheckPending', { count: pendingChecks })}</Banner>
      ) : null}
      <ul className="checklist" aria-label={t('admin.results.publish.title')}>
        {publish.checklist.map((check) => (
          <li key={check.code} className="checklist__item t-body">
            <StatusTag tone={check.count === 0 ? 'success' : 'error'}>
              {check.count === 0 ? `✓ ${t('admin.results.check.done')}` : check.count}
            </StatusTag>
            <span>{t(`admin.results.check.${check.code}`, { count: check.count })}</span>
            {check.code === 'open_disputes' && check.count > 0 && canReadDisputes ? (
              <Link className="link" to="/disputes" search={{ raceId }}>
                {t('admin.results.check.open_disputes.link')}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="form-actions">
          <Button
            variant="primary"
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? publishReasonId : undefined}
            onClick={() => {
              if (blocked) return;
              open({
                title: t('admin.results.publish.dialogTitle'),
                consequences: t('admin.results.publish.consequences'),
                confirmLabel: t('admin.results.publish.action'),
                run: (reason) => run(() => api.publishProtocol(raceId, { reason })),
              });
            }}
          >
            {t('admin.results.publish.action')}
          </Button>
          {blocked && blockText ? (
            <DisabledReason id={publishReasonId}>{blockText}</DisabledReason>
          ) : (
            <p className="page-note t-meta">{t('admin.results.publish.ready')}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
