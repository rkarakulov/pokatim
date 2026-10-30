import type { EventReminder, EventReminderInput } from '@pokatim/contracts';

import type { ReminderDispatchDoc, ReminderRuleDoc } from './tickets.collection';

const HOUR = 3_600_000;

/** Время отправки правила: старт − `offsetHours`. */
export const reminderDueAt = (startsAt: Date, offsetHours: number) =>
  new Date(startsAt.getTime() - offsetHours * HOUR);

const sentBy = (dispatches: readonly ReminderDispatchDoc[], id: string, dueAt: Date) =>
  dispatches.find((d) => d.reminderId === id && d.dueAt.getTime() === dueAt.getTime());

/**
 * Правила к отправке сейчас (RC-D3, RC-D5): событие `scheduled`, `armedAt ≤ dueAt ≤ now < startsAt` и отправки по
 * этому `dueAt` ещё нет (смена offset или старта — новый `dueAt`, отправка только билетам без метки правила).
 * Просроченное правило догоняется, пока событие не началось.
 */
export function dueReminders(
  event: { state: 'scheduled' | 'cancelled'; startsAt: Date },
  rules: readonly ReminderRuleDoc[],
  dispatches: readonly ReminderDispatchDoc[],
  now: Date,
): { rule: ReminderRuleDoc; dueAt: Date }[] {
  if (event.state !== 'scheduled' || now >= event.startsAt) return [];
  return rules
    .map((rule) => ({ rule, dueAt: reminderDueAt(event.startsAt, rule.offsetHours) }))
    .filter(
      ({ rule, dueAt }) =>
        rule.armedAt <= dueAt && dueAt <= now && !sentBy(dispatches, rule.id, dueAt),
    );
}

export type ReminderIssue = { path: string; code: 'INVALID' };

/**
 * Новый список правил из запроса панели (RC-D4, RC-D10): с `id` — правка существующего (`armedAt` сохраняется, при
 * смене `offsetHours` — `now`), без `id` — новое (`newId()`, `armedAt = now`); `id` не из текущих или повтор — 400.
 */
export function nextReminders(
  current: readonly ReminderRuleDoc[],
  input: readonly EventReminderInput[],
  now: Date,
  newId: () => string,
): { rules: ReminderRuleDoc[] } | { issues: ReminderIssue[] } {
  const issues: ReminderIssue[] = [];
  const seen = new Set<string>();
  const rules = input.map((item, index): ReminderRuleDoc => {
    if (item.id === undefined) {
      return { id: newId(), offsetHours: item.offsetHours, text: item.text, armedAt: now };
    }
    const existing = current.find((rule) => rule.id === item.id);
    if (!existing || seen.has(item.id))
      issues.push({ path: `reminders.${index}.id`, code: 'INVALID' });
    seen.add(item.id);
    const armedAt = existing && existing.offsetHours === item.offsetHours ? existing.armedAt : now;
    return { id: item.id, offsetHours: item.offsetHours, text: item.text, armedAt };
  });
  return issues.length > 0 ? { issues } : { rules };
}

/** Одинаковые правила (для `changedFields`): порядок, id, offset, текст. */
export const sameReminders = (a: readonly ReminderRuleDoc[], b: readonly ReminderRuleDoc[]) =>
  a.length === b.length &&
  a.every(
    (rule, i) =>
      rule.id === b[i]!.id && rule.offsetHours === b[i]!.offsetHours && rule.text === b[i]!.text,
  );

/** Правило в ответе панели: время отправки по текущему старту, отправка по нему, «поздно» (RC-D5). */
export function reminderView(
  rule: ReminderRuleDoc,
  startsAt: Date | null,
  dispatches: readonly ReminderDispatchDoc[],
): EventReminder {
  const dueAt = startsAt === null ? null : reminderDueAt(startsAt, rule.offsetHours);
  const sent = dueAt === null ? undefined : sentBy(dispatches, rule.id, dueAt);
  return {
    id: rule.id,
    offsetHours: rule.offsetHours,
    text: rule.text,
    sendAt: dueAt?.toISOString() ?? null,
    sentAt: sent?.at.toISOString() ?? null,
    sentCount: sent?.count ?? 0,
    late: dueAt !== null && !sent && rule.armedAt > dueAt,
  };
}
