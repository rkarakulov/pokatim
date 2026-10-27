import { apiErrorOf } from '@pokatim/api-client';
import {
  DISPUTE_RESPONSE_MIN,
  DisputeActionBlockedDetails,
  DisputeFileRequest,
  DisputeResponseRequest,
  type DisputeAgainstMe,
  type MyDispute,
  type MyRaceDisputes,
  type ResultGroupKey,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';

import { actionErrorMessage, fieldErrorMessage } from '@/features/auth/error-messages';
import { minskDateTime } from '@/lib/minsk-format';

/*
 * Споры (race-results-06) — чистая логика показа. Право подачи, сроки и статусы — только с сервера
 * (`MyRaceDisputes.filing`, `canRespond`): здесь выбираются тексты и действия. `'unknown'` — нейтрально.
 */

type Status = MyDispute['status'];

/** Плашка статуса спора: открытый — warning (ждёт решения), закрытые — нейтрально (исход — текстом). */
export function disputeStatus(status: Status): { label: string; tone: PillTone } {
  return { label: t(`disputes.status.${status}`), tone: status === 'open' ? 'warning' : 'neutral' };
}

/** Момент спора по Минску, всегда с годом: «13 октября 2026, 12:00». */
export function disputeDate(iso: string): string {
  const { date, time } = minskDateTime(iso, null);
  return t('format.dateTime', { date, time });
}

export const categoryLabel = (category: MyDispute['category']) =>
  t(`disputes.category.${category}`);

/** Исход для заявителя: «Удовлетворён: <шаблон>»; решения нет — `null`. */
export function filedDecisionText(dispute: MyDispute): string | null {
  if (!dispute.decision) return null;
  return t('disputes.mine.decision', {
    status: t(`disputes.status.${dispute.decision.outcome}`),
    template: t(`disputes.template.${dispute.decision.template}`),
  });
}

/** Исход для участника, чей результат оспорен. */
export function againstDecisionText(dispute: DisputeAgainstMe): string | null {
  if (!dispute.decision) return null;
  return t('disputes.against.decision', {
    status: t(`disputes.status.${dispute.decision.outcome}`),
    template: t(`disputes.template.${dispute.decision.template}`),
  });
}

export type RivalAction =
  | { kind: 'file'; note: string }
  | { kind: 'closed'; note: string }
  | { kind: 'mine'; dispute: MyDispute };

type GroupKey = ResultGroupKey | 'unknown' | null | undefined;

/**
 * Цель — в чужой группе зачёта (race-results-07): сервер отклонит подачу (`409 target_not_counted`). Группа своей заявки
 * или строки неизвестна (`null`, `'unknown'`, старый API) — не чужая, решает сервер.
 */
export function inOtherGroup(own: GroupKey, target: GroupKey): boolean {
  const known = (key: GroupKey): key is ResultGroupKey => key != null && key !== 'unknown';
  return known(own) && known(target) && own !== target;
}

/**
 * Действие карточки соперника по `filing` (§7.8, M1): мой спор по строке — его статус; цель в чужой группе
 * (`otherGroup`) — ничего; `open` — «Оспорить результат» и срок; `closed` — выключенное действие с причиной (срок —
 * с датой протокола); `unavailable` / `unknown` — ничего.
 */
export function rivalAction(
  disputes: MyRaceDisputes,
  entryId: string,
  otherGroup = false,
): RivalAction | null {
  const mine = disputes.filed.find((dispute) => dispute.targetEntryId === entryId);
  if (mine) return { kind: 'mine', dispute: mine };
  if (otherGroup) return null;
  const { filing } = disputes;
  if (filing.status === 'open') {
    return { kind: 'file', note: t('disputes.file.until', { date: disputeDate(filing.closesAt) }) };
  }
  if (filing.status !== 'closed') return null;
  const reason = filing.reason ?? 'filing_closed';
  return {
    kind: 'closed',
    note:
      reason === 'filing_closed'
        ? t('disputes.file.closed', { date: disputeDate(filing.protocolPlannedAt) })
        : t(`disputes.filingBlock.${reason}`),
  };
}

/**
 * Строка таблицы нажимаема, только когда карточке есть что показать (RC-14): гостю, неучастнику и на чужую группу
 * зачёта — нет.
 */
export function canOpenRival(
  disputes: MyRaceDisputes | null | undefined,
  entryId: string,
  otherGroup = false,
): boolean {
  return disputes ? rivalAction(disputes, entryId, otherGroup) !== null : false;
}

/** Опрос споров — пока есть открытый спор (решение, отзыв). */
export function needsDisputePolling(disputes: MyRaceDisputes | null | undefined): boolean {
  if (!disputes) return false;
  return [...disputes.filed, ...disputes.against].some((dispute) => dispute.status === 'open');
}

/** Код ошибки zod-схемы контракта → текст поля. */
function issueText(
  result: { success: true } | { success: false; error: { issues: { message: string }[] } },
): string | undefined {
  if (result.success) return undefined;
  const code = result.error.issues[0]?.message ?? 'INVALID';
  if (code === 'TOO_SHORT') return t('auth.field.TOO_SHORT', { min: DISPUTE_RESPONSE_MIN });
  return fieldErrorMessage(code);
}

/** Описание спора: необязательно, ≤ 2000, без управляющих символов. */
export const descriptionError = (text: string) =>
  issueText(DisputeFileRequest.shape.description.safeParse(text));

/** Ответ участника: пусто — без ошибки (кнопка выключена); иначе схема контракта (3–2000). */
export const responseError = (text: string) =>
  text.trim() === '' ? undefined : issueText(DisputeResponseRequest.shape.text.safeParse(text));

/** Отказ действия со спором: `409` — по `details.reason`, `404` — «Спор не найден», иначе общий текст. */
export function disputeErrorText(error: unknown): string {
  const parsed = apiErrorOf(error);
  if (parsed?.code === 'DISPUTE_NOT_FOUND') return t('disputes.error.DISPUTE_NOT_FOUND');
  if (parsed?.code === 'DISPUTE_ACTION_BLOCKED') {
    const details = DisputeActionBlockedDetails.safeParse(parsed.details);
    const reason = details.success ? details.data.reason : 'unknown';
    return t(`disputes.error.DISPUTE_ACTION_BLOCKED.${reason}`);
  }
  return actionErrorMessage(error);
}
