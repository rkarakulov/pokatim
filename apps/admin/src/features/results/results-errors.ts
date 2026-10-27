import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  type PanelRaceResults,
  ResultsActionBlockedDetails,
  ResultsPublishBlockedDetails,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { httpStatus, isForbidden } from '../../session/errors';

type Publish = Pick<PanelRaceResults['publish'], 'blockedBy' | 'checklist'>;

/**
 * Почему протокол не опубликовать: состояние гонки — одной причиной, иначе все непустые строки чек-листа
 * («Открытые споры: 4. Срок загрузки заездов ещё не истёк.»).
 */
export function publishBlockText(publish: Publish): string | undefined {
  if (publish.blockedBy) return t(`admin.results.blockedBy.${publish.blockedBy}`);
  const open = publish.checklist.filter((check) => check.count > 0);
  return open.length > 0
    ? `${open.map((check) => t(`admin.results.check.${check.code}`, { count: check.count })).join('. ')}.`
    : undefined;
}

/**
 * Текст ошибки действия над результатами: `RESULTS_ACTION_BLOCKED` — по `details.reason` (с количеством
 * незавершённых проверок), `RESULTS_PUBLISH_BLOCKED` — причины чек-листа из `details`.
 */
export function resultsErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  if (isForbidden(error)) return t('admin.error.forbidden');
  const parsed = apiErrorOf(error);
  switch (parsed?.code) {
    case 'RESULTS_ACTION_BLOCKED': {
      const details = ResultsActionBlockedDetails.safeParse(parsed.details);
      return details.success
        ? t(`admin.results.blocked.${details.data.reason}`, { count: details.data.count ?? 0 })
        : t('admin.results.error.RESULTS_ACTION_BLOCKED');
    }
    case 'RESULTS_PUBLISH_BLOCKED': {
      const details = ResultsPublishBlockedDetails.safeParse(parsed.details);
      return (
        (details.success ? publishBlockText(details.data) : undefined) ??
        t('admin.results.error.RESULTS_PUBLISH_BLOCKED')
      );
    }
    case 'RATE_LIMITED':
      return t('error.rateLimited');
    default:
      return httpStatus(error) === 404 ? t('admin.races.notFound') : t('error.unknown');
  }
}
