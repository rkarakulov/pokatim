import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  DISPUTE_DECIDE_BLOCKS,
  DISPUTE_STATUSES,
  DisputeActionBlockedDetails,
  type DisputeDecideBlock,
  type DisputeStatus,
  Uuid,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { formatDateTimeLong } from '../../format';
import { httpStatus, isForbidden } from '../../session/errors';

/** Фильтр «Все» статусы — в URL `?status=all`; без параметра — «На рассмотрении» (по умолчанию). */
export const ALL_STATUSES = 'all';
export type DisputesStatusFilter = DisputeStatus | typeof ALL_STATUSES;

/** Фильтры списка из URL: статус и гонка (`?raceId=` — со ссылки чек-листа «Результатов»). */
export interface DisputesSearch {
  status?: Exclude<DisputesStatusFilter, 'open'>;
  raceId?: string;
}

export function validateDisputesSearch(search: Record<string, unknown>): DisputesSearch {
  const status =
    search.status === ALL_STATUSES ||
    (DISPUTE_STATUSES.includes(search.status as DisputeStatus) && search.status !== 'open')
      ? (search.status as DisputesSearch['status'])
      : undefined;
  const raceId = Uuid.safeParse(search.raceId).success ? (search.raceId as string) : undefined;
  return { status, raceId };
}

/** Тон статуса спора: на рассмотрении — ink, удовлетворён (DQ) — ошибка, отклонён — успех, отозван — нейтральный. */
export const DISPUTE_STATUS_TONE: Record<DisputeStatus, 'success' | 'neutral' | 'error' | 'ink'> = {
  open: 'ink',
  withdrawn: 'neutral',
  upheld: 'error',
  rejected: 'success',
};

/** Почему решение недоступно (`decideBlockedBy`; `too_early` — с моментом D-25). */
export function decideBlockText(block: DisputeDecideBlock, availableAt: string): string {
  return t(`admin.disputes.decideBlock.${block}`, { date: formatDateTimeLong(availableAt) });
}

/** Текст ошибки решения: `409 DISPUTE_ACTION_BLOCKED` — по `details.reason` (`too_early` — с `availableAt`). */
export function decideErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  if (isForbidden(error)) return t('admin.error.forbidden');
  const parsed = apiErrorOf(error);
  switch (parsed?.code) {
    case 'DISPUTE_ACTION_BLOCKED': {
      const details = DisputeActionBlockedDetails.safeParse(parsed.details);
      const reason = details.success ? details.data.reason : undefined;
      return reason && (DISPUTE_DECIDE_BLOCKS as readonly string[]).includes(reason)
        ? decideBlockText(reason as DisputeDecideBlock, details.data?.availableAt ?? '')
        : t('admin.disputes.error.DISPUTE_ACTION_BLOCKED');
    }
    case 'DISPUTE_NOT_FOUND':
      return t('admin.disputes.error.DISPUTE_NOT_FOUND');
    case 'RATE_LIMITED':
      return t('error.rateLimited');
    default:
      return httpStatus(error) === 404 ? t('admin.disputes.notFound') : t('error.unknown');
  }
}
