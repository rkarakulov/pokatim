import { describe, expect, it } from 'vitest';

import type { ReminderDispatchDoc, ReminderRuleDoc } from './tickets.collection';
import { dueReminders, nextReminders, reminderDueAt, reminderView } from './reminders.policy';

const HOUR = 3_600_000;
const START = new Date('2026-10-24T07:00:00Z');
const at = (hoursFromStart: number) => new Date(START.getTime() + hoursFromStart * HOUR);
const ID_A = '01890a5d-ac96-774b-bcce-b302099a8057';
const ID_B = '01890a5d-ac96-774b-bcce-b302099a8058';

const rule = (overrides: Partial<ReminderRuleDoc> = {}): ReminderRuleDoc => ({
  id: ID_A,
  offsetHours: 24,
  text: 'Возьмите паспорт',
  armedAt: at(-48),
  ...overrides,
});
const dispatch = (overrides: Partial<ReminderDispatchDoc> = {}): ReminderDispatchDoc => ({
  reminderId: ID_A,
  dueAt: at(-24),
  dispatchId: ID_B,
  at: at(-24),
  count: 3,
  ...overrides,
});
const scheduled = { state: 'scheduled' as const, startsAt: START };

describe('reminderDueAt', () => {
  it('старт − offsetHours', () => {
    expect(reminderDueAt(START, 24)).toEqual(at(-24));
    expect(reminderDueAt(START, 1)).toEqual(at(-1));
  });
});

describe('dueReminders: что отправить сейчас (RC-D3, RC-D5)', () => {
  it('граница: dueAt ≤ now < startsAt — да; раньше dueAt и с момента старта — нет', () => {
    const rules = [rule()];
    expect(dueReminders(scheduled, rules, [], at(-24.01))).toEqual([]);
    expect(dueReminders(scheduled, rules, [], at(-24))).toEqual([
      { rule: rules[0], dueAt: at(-24) },
    ]);
    // догоняние: регламент лёг и поднялся позже
    expect(dueReminders(scheduled, rules, [], at(-1))).toHaveLength(1);
    expect(dueReminders(scheduled, rules, [], at(0))).toEqual([]);
  });

  it('событие не scheduled — ничего', () => {
    expect(dueReminders({ state: 'cancelled', startsAt: START }, [rule()], [], at(-1))).toEqual([]);
  });

  it('уже отправлено по этому dueAt — нет; dueAt сменился (offset, старт) — снова к отправке', () => {
    expect(dueReminders(scheduled, [rule()], [dispatch()], at(-1))).toEqual([]);
    expect(dueReminders(scheduled, [rule({ offsetHours: 2 })], [dispatch()], at(-1))).toEqual([
      { rule: rule({ offsetHours: 2 }), dueAt: at(-2) },
    ]);
    expect(
      dueReminders(scheduled, [rule()], [dispatch({ reminderId: ID_B })], at(-1)),
    ).toHaveLength(1);
  });

  it('правило задано после своего времени отправки — не уходит (armedAt > dueAt); armedAt = dueAt — уходит', () => {
    expect(dueReminders(scheduled, [rule({ armedAt: at(-23) })], [], at(-1))).toEqual([]);
    expect(dueReminders(scheduled, [rule({ armedAt: at(-24) })], [], at(-1))).toHaveLength(1);
  });
});

describe('nextReminders: правка правил панелью (RC-D4, RC-D10)', () => {
  const now = at(-72);
  let seq = 0;
  const newId = () => `00000000-0000-7000-8000-00000000000${(seq += 1)}`;

  it('новое правило — id сервера и armedAt = now; существующее — id и armedAt сохраняются при смене текста', () => {
    seq = 0;
    const current = [rule()];
    const result = nextReminders(
      current,
      [
        { id: ID_A, offsetHours: 24, text: 'Новый текст' },
        { offsetHours: 2, text: 'Через два часа' },
      ],
      now,
      newId,
    );
    expect(result).toEqual({
      rules: [
        { id: ID_A, offsetHours: 24, text: 'Новый текст', armedAt: at(-48) },
        {
          id: '00000000-0000-7000-8000-000000000001',
          offsetHours: 2,
          text: 'Через два часа',
          armedAt: now,
        },
      ],
    });
  });

  it('смена offsetHours — armedAt = now (RC-D5); удаление — правила нет', () => {
    expect(nextReminders([rule()], [{ id: ID_A, offsetHours: 48, text: 'Т' }], now, newId)).toEqual(
      { rules: [{ id: ID_A, offsetHours: 48, text: 'Т', armedAt: now }] },
    );
    expect(nextReminders([rule()], [], now, newId)).toEqual({ rules: [] });
  });

  it('id не из текущих правил или повтор id — 400 по пути', () => {
    expect(nextReminders([rule()], [{ id: ID_B, offsetHours: 1, text: 'Т' }], now, newId)).toEqual({
      issues: [{ path: 'reminders.0.id', code: 'INVALID' }],
    });
    expect(
      nextReminders(
        [rule()],
        [
          { id: ID_A, offsetHours: 1, text: 'Т' },
          { id: ID_A, offsetHours: 2, text: 'Т' },
        ],
        now,
        newId,
      ),
    ).toEqual({ issues: [{ path: 'reminders.1.id', code: 'INVALID' }] });
  });
});

describe('reminderView: статус правила в панели', () => {
  it('без старта — sendAt null; ждёт отправки; отправлено по текущему dueAt; поздно', () => {
    expect(reminderView(rule(), null, [])).toEqual({
      id: ID_A,
      offsetHours: 24,
      text: 'Возьмите паспорт',
      sendAt: null,
      sentAt: null,
      sentCount: 0,
      late: false,
    });
    expect(reminderView(rule(), START, [])).toMatchObject({
      sendAt: at(-24).toISOString(),
      sentAt: null,
      late: false,
    });
    expect(reminderView(rule(), START, [dispatch()])).toMatchObject({
      sentAt: at(-24).toISOString(),
      sentCount: 3,
      late: false,
    });
    // отправка по прежнему offset не считается отправкой нового времени
    expect(reminderView(rule({ offsetHours: 2 }), START, [dispatch()])).toMatchObject({
      sendAt: at(-2).toISOString(),
      sentAt: null,
      sentCount: 0,
    });
    expect(reminderView(rule({ armedAt: at(-10) }), START, [])).toMatchObject({
      late: true,
    });
  });
});
