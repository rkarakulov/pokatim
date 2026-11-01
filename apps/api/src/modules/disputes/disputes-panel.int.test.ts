import {
  MyRaceEntry,
  PanelDispute,
  PanelDisputePage,
  PanelRaceStandings,
  RaceResultsPage,
} from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ADMIN_DISPUTES,
  decideDispute,
  disputeRace,
  disputesDb,
  fileDispute,
  filedId,
  myDisputes,
  panelDispute,
  refusal,
  respondDispute,
  travelFresh,
} from '../../../test/disputes';
import { createHarness, type Harness, HOUR } from '../../../test/harness';
import { call, outboxEvents } from '../../../test/identity';
import { panel, panelCall } from '../../../test/panel';
import { RACES, staff } from '../../../test/races';
import { entryUrl, panelResults, protocolAction, resultsDb } from '../../../test/results';

/**
 * Споры в панели (race-results-06: AC5, AC6, AC8, RC-2, RC-3): список, разбор, решение (D-25, D-43), журнал, чек-лист
 * и протокол. Гонка `disputeRace`: часы — после срока загрузки (27.10 21:00 UTC), приём открыт до 29.10 20:59 UTC.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const UPHELD = { outcome: 'upheld', template: 'speed_implausible', note: 'Скорость 70 км/ч' };
const REJECTED = { outcome: 'rejected', template: 'track_confirmed' };
const UNKNOWN_DISPUTE = '01890a5d-ac96-774b-bcce-b302099a8057';

/** Гонка с тремя результатами и спором rider0 → rider1; часы — через 12 ч после подачи. */
async function decidable(times: readonly (number | null)[] = [3600, 3700, 3800]) {
  const race = await disputeRace(h, times);
  const [me, rival] = race.riders;
  const filedAt = h.clock.now();
  const id = filedId(
    await fileDispute(h, me!.auth, race.raceId, {
      targetEntryId: rival!.entryId,
      category: 'speed_vs_heart_rate',
      description: 'Пульс 90 на 50 км/ч',
    }),
  );
  return { ...race, id, filedAt };
}

describe('решение (AC5)', () => {
  it('раньше filedAt + 12 ч — 409 too_early с availableAt; разбор — canDecide false', async () => {
    const { id, token, filedAt } = await decidable();
    const availableAt = new Date(filedAt.getTime() + 12 * HOUR).toISOString();
    const early = await decideDispute(h, token, id, UPHELD);
    expect([early.status, early.body]).toMatchObject([
      409,
      { code: 'DISPUTE_ACTION_BLOCKED', details: { reason: 'too_early', availableAt } },
    ]);
    expect(await panelDispute(h, token, id)).toMatchObject({
      canDecide: false,
      decideBlockedBy: 'too_early',
      decidableAt: availableAt,
    });
  });

  it('upheld: заявка DQ, результат dq без места, нет в таблице, места пересчитаны, журнал пересчётов; событие, outbox, журнал; повтор — not_open', async () => {
    const race = await decidable();
    const { riders, token } = await travelFresh(
      h,
      new Date(race.filedAt.getTime() + 12 * HOUR),
      race.riders,
    );
    const [, rival, third] = riders;
    const res = await decideDispute(h, token, race.id, UPHELD);
    expect(res.status).toBe(200);
    const decided = PanelDispute.parse(res.body);
    expect(decided).toMatchObject({
      status: 'upheld',
      canDecide: false,
      decideBlockedBy: 'not_open',
      decision: {
        outcome: 'upheld',
        template: 'speed_implausible',
        note: 'Скорость 70 км/ч',
        actor: { displayName: 'Сотрудник admin' },
      },
      target: { entryId: rival!.entryId, resultStatus: 'dq', place: null, elapsedSec: 3700 },
    });
    expect(decided.events.map((event) => [event.kind, event.actorKind])).toEqual([
      ['filed', 'rider'],
      ['decided', 'staff'],
    ]);

    expect((await resultsDb(h).entries.findOne({ _id: rival!.entryId }))?.disqualified).toEqual({
      at: h.clock.now(),
      disputeId: race.id,
    });
    const view = MyRaceEntry.parse(
      (await call(h, 'GET', entryUrl(race.raceId), undefined, rival!.auth)).body,
    );
    expect(view.result).toMatchObject({ status: 'dq', place: null, elapsedSec: 3700, ranked: 2 });
    // после срока загрузки действия закрыты своими причинами — DQ их не дублирует (RC-4)
    expect(view.actions.reasons).toEqual(['window_closed', 'upload_closed']);
    const table = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${race.raceId}/results`)).body,
    );
    expect(table.items.map((row) => [row.entryId, row.place])).toEqual([
      [riders[0]!.entryId, 1],
      [third!.entryId, 2],
    ]);
    expect(await resultsDb(h).recalculations.find().toArray()).toMatchObject([
      {
        kind: 'disqualified',
        revision: null,
        entryId: rival!.entryId,
        reason: `dispute:${race.id}`,
        at: h.clock.now(),
      },
    ]);
    const outbox = (await outboxEvents(h)).filter(
      (event) => event.type === 'disputes.dispute-decided',
    );
    expect(outbox.map((event) => event.payload)).toEqual([
      { disputeId: race.id, raceId: race.raceId, outcome: 'upheld' },
    ]);
    const audit = await panel(h).audit.find({ action: 'disputes.decided' }).toArray();
    expect(audit.map((doc) => [doc.reason, doc.subject, doc.details])).toEqual([
      [
        'Скорость 70 км/ч',
        { kind: 'race', id: race.raceId, label: 'Минское кольцо' },
        { disputeId: race.id, entryId: rival!.entryId },
      ],
    ]);

    // участники видят исход и шаблон — без заметки
    const against = await myDisputes(h, rival!.auth, race.raceId);
    expect(against.against[0]).toMatchObject({
      status: 'upheld',
      decision: { outcome: 'upheld', template: 'speed_implausible' },
    });
    expect(JSON.stringify(against)).not.toContain('70 км/ч');
    const filed = await myDisputes(h, riders[0]!.auth, race.raceId);
    expect(filed.filed[0]).toMatchObject({
      status: 'upheld',
      closedAt: h.clock.now().toISOString(),
    });
    expect(JSON.stringify(filed)).not.toContain('70 км/ч');

    expect(refusal(await decideDispute(h, token, race.id, REJECTED))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'not_open',
    ]);
  });

  it('rejected: результат без изменений; журнал — код шаблона без заметки', async () => {
    const race = await decidable();
    const { riders, token } = await travelFresh(
      h,
      new Date(race.filedAt.getTime() + 12 * HOUR),
      race.riders,
    );
    const res = await decideDispute(h, token, race.id, REJECTED);
    expect(PanelDispute.parse(res.body)).toMatchObject({
      status: 'rejected',
      decision: { outcome: 'rejected', template: 'track_confirmed', note: null },
      target: { resultStatus: 'provisional', place: 2 },
    });
    expect(
      (await resultsDb(h).entries.findOne({ _id: riders[1]!.entryId }))?.disqualified,
    ).toBeNull();
    expect(await resultsDb(h).recalculations.countDocuments()).toBe(0);
    expect(
      (await panel(h).audit.find({ action: 'disputes.decided' }).toArray()).map(
        (doc) => doc.reason,
      ),
    ).toEqual(['track_confirmed']);
    const view = MyRaceEntry.parse(
      (await call(h, 'GET', entryUrl(race.raceId), undefined, riders[1]!.auth)).body,
    );
    expect(view.result).toMatchObject({ status: 'provisional', place: 2 });
  });

  it('шаблон не из карты исхода — 400; неизвестный спор — 404', async () => {
    const race = await decidable();
    const { token } = await travelFresh(h, new Date(race.filedAt.getTime() + 12 * HOUR), []);
    expect(
      (await decideDispute(h, token, race.id, { outcome: 'upheld', template: 'track_confirmed' }))
        .status,
    ).toBe(400);
    expect(refusal(await decideDispute(h, token, UNKNOWN_DISPUTE, UPHELD))).toEqual([
      404,
      'DISPUTE_NOT_FOUND',
      undefined,
    ]);
  });

  it('два upheld против одной цели — одна запись журнала пересчётов (идемпотентный DQ)', async () => {
    const race = await disputeRace(h, [3600, 3700, 3800]);
    const [a, target, c] = race.riders;
    const first = filedId(
      await fileDispute(h, a!.auth, race.raceId, {
        targetEntryId: target!.entryId,
        category: 'other',
      }),
    );
    const second = filedId(
      await fileDispute(h, c!.auth, race.raceId, {
        targetEntryId: target!.entryId,
        category: 'other',
      }),
    );
    const { token } = await travelFresh(h, new Date(h.clock.now().getTime() + 12 * HOUR), []);
    expect((await decideDispute(h, token, first, UPHELD)).status).toBe(200);
    expect((await decideDispute(h, token, second, UPHELD)).status).toBe(200);
    expect(await resultsDb(h).recalculations.countDocuments({ entryId: target!.entryId })).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'disputes.decided' })).toBe(2);
  });
});

describe('права (AC6)', () => {
  it('без disputes.decide — 403; organizer — 403 на список и разбор; moderator — читает и решает', async () => {
    const race = await decidable();
    const org = await staff(h, 'org@example.by', 'organizer');
    const mod = await staff(h, 'mod@example.by', 'moderator');
    expect((await panelCall(h, org.token, 'GET', ADMIN_DISPUTES)).status).toBe(403);
    expect((await panelCall(h, org.token, 'GET', `${ADMIN_DISPUTES}/${race.id}`)).status).toBe(403);
    expect((await decideDispute(h, org.token, race.id, UPHELD)).status).toBe(403);
    expect((await panelCall(h, undefined, 'GET', ADMIN_DISPUTES)).status).toBe(401);
    expect((await panelCall(h, mod.token, 'GET', ADMIN_DISPUTES)).status).toBe(200);
    expect(refusal(await decideDispute(h, mod.token, race.id, UPHELD))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'too_early',
    ]);
  });
});

describe('список и разбор', () => {
  it('фильтр статуса и гонки, новые сверху, курсор; разбор — заявитель, описание, ответ, история', async () => {
    const race = await disputeRace(h, [3600, 3700, 3800, 3900]);
    const [a, b, c, d] = race.riders;
    const ids: string[] = [];
    for (const [from, to] of [
      [a, b],
      [c, d],
      [b, a],
    ] as const) {
      ids.push(
        filedId(
          await fileDispute(h, from!.auth, race.raceId, {
            targetEntryId: to!.entryId,
            category: 'other',
          }),
        ),
      );
      h.clock.advance(60_000);
    }
    expect((await respondDispute(h, b!.auth, ids[0]!, 'Это мой трек')).status).toBe(200);
    const token = race.token;
    const page = async (query: string) => {
      const res = await panelCall(h, token, 'GET', `${ADMIN_DISPUTES}${query}`);
      expect(res.status, query).toBe(200);
      return PanelDisputePage.parse(res.body);
    };
    const all = await page('');
    expect(all.items.map((item) => item.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(all.items[2]).toMatchObject({
      race: { id: race.raceId, title: 'Минское кольцо' },
      status: 'open',
      category: 'other',
      targetEntryId: b!.entryId,
      complainantEntryId: a!.entryId,
      responded: true,
    });
    const first = await page('?limit=2');
    expect(first.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    const next = await page(`?limit=2&cursor=${first.nextCursor}`);
    expect(next.items.map((item) => item.id)).toEqual([ids[0]]);
    expect(next.nextCursor).toBeNull();
    expect((await page(`?raceId=${race.raceId}&status=open`)).items).toHaveLength(3);
    expect((await page('?status=upheld')).items).toEqual([]);
    expect((await page(`?raceId=01890a5d-ac96-774b-bcce-b302099a8057`)).items).toEqual([]);
    expect((await panelCall(h, token, 'GET', `${ADMIN_DISPUTES}?status[$ne]=open`)).status).toBe(
      400,
    );
    expect((await panelCall(h, token, 'GET', `${ADMIN_DISPUTES}?cursor=abc`)).status).toBe(400);

    const detail = await panelDispute(h, token, ids[0]!);
    expect(detail).toMatchObject({
      complainant: { entryId: a!.entryId, userId: a!.userId },
      target: { entryId: b!.entryId, userId: b!.userId, resultStatus: 'provisional', place: 2 },
      description: null,
      response: { text: 'Это мой трек' },
      decision: null,
      canDecide: false,
      decideBlockedBy: 'too_early',
    });
    expect(detail.events.map((event) => event.kind)).toEqual(['filed', 'responded']);
  });
});

describe('имя райдера в панели (Q2 profile.md)', () => {
  it('цель и заявитель: имя только при имени и согласии, без согласия и без профиля — null; ключи; в спор не пишется', async () => {
    const race = await disputeRace(h, [3600, 3700, 3800]);
    const [named, hidden, bare] = race.riders;
    for (const [who, body] of [
      [named!, { publicName: 'Анна К.', showNameInResults: true }],
      [hidden!, { publicName: 'Скрытый', showNameInResults: false }],
    ] as const) {
      expect((await call(h, 'PATCH', '/v1/profile', body, who.auth)).status).toBe(200);
    }
    const toHidden = filedId(
      await fileDispute(h, named!.auth, race.raceId, {
        targetEntryId: hidden!.entryId,
        category: 'other',
      }),
    );
    h.clock.advance(60_000);
    const toNamed = filedId(
      await fileDispute(h, bare!.auth, race.raceId, {
        targetEntryId: named!.entryId,
        category: 'other',
      }),
    );
    const res = await panelCall(h, race.token, 'GET', ADMIN_DISPUTES);
    expect(res.status).toBe(200);
    const page = PanelDisputePage.parse(res.body);
    expect(
      page.items.map((item) => [item.id, item.targetRiderName, item.complainantRiderName]),
    ).toEqual([
      [toNamed, 'Анна К.', null],
      [toHidden, null, 'Анна К.'],
    ]);
    expect(Object.keys((res.body as { items: object[] }).items[0]!).sort()).toEqual(
      [
        'category',
        'complainantEntryId',
        'complainantRiderName',
        'decidableAt',
        'filedAt',
        'id',
        'race',
        'responded',
        'status',
        'targetEntryId',
        'targetRiderName',
      ].sort(),
    );

    expect(await panelDispute(h, race.token, toHidden)).toMatchObject({
      targetRiderName: null,
      complainantRiderName: 'Анна К.',
      target: { entryId: hidden!.entryId, userId: hidden!.userId, riderName: null },
      complainant: { entryId: named!.entryId, userId: named!.userId, riderName: 'Анна К.' },
    });
    expect(await panelDispute(h, race.token, toNamed)).toMatchObject({
      target: { entryId: named!.entryId, riderName: 'Анна К.' },
      complainant: { entryId: bare!.entryId, riderName: null },
    });
    const docs = await disputesDb(h).disputes.find({}).toArray();
    expect(docs.every((doc) => !JSON.stringify(doc).includes('Анна К.'))).toBe(true);
  });
});

describe('чек-лист и протокол (AC8, RC-2, RC-3)', () => {
  it('открытый спор блокирует публикацию; после upheld — снимок со строкой dq без места; «Отменить DQ» — revised с местом', async () => {
    const race = await decidable();
    const summary = await panelResults(h, race.token, race.raceId);
    expect(summary.publish.checklist.find((row) => row.code === 'open_disputes')?.count).toBe(1);
    const blocked = await protocolAction(h, race.token, race.raceId, '/protocol');
    expect([blocked.status, (blocked.body as { code: string }).code]).toEqual([
      409,
      'RESULTS_PUBLISH_BLOCKED',
    ]);

    // «Участники» до публикации — DQ в прочих
    const { riders, token } = await travelFresh(
      h,
      new Date(race.filedAt.getTime() + 12 * HOUR),
      race.riders,
    );
    expect((await decideDispute(h, token, race.id, UPHELD)).status).toBe(200);
    const standings = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', `${RACES}/${race.raceId}/standings`)).body,
    );
    expect(standings.items.map((row) => [row.entryId, row.resultStatus, row.place])).toEqual([
      [riders[0]!.entryId, 'provisional', 1],
      [riders[2]!.entryId, 'provisional', 2],
      [riders[1]!.entryId, 'dq', null],
    ]);

    expect((await protocolAction(h, token, race.raceId, '/protocol')).status).toBe(200);
    const rows = await resultsDb(h)
      .protocolRows.find({ raceId: race.raceId, revision: 1 })
      .sort({ order: 1 })
      .toArray();
    expect(rows.map((row) => [row.entryId, row.place, row.status])).toEqual([
      [riders[0]!.entryId, 1, 'final'],
      [riders[2]!.entryId, 2, 'final'],
      [riders[1]!.entryId, null, 'dq'],
    ]);
    const view = MyRaceEntry.parse(
      (await call(h, 'GET', entryUrl(race.raceId), undefined, riders[1]!.auth)).body,
    );
    expect(view.result).toMatchObject({ status: 'dq', place: null, elapsedSec: 3700 });

    // «Применить пересчёт» сохраняет dq (RC-2)
    h.clock.advance(1000);
    expect(
      (await protocolAction(h, token, race.raceId, '/protocol/recheck', { reason: 'Перепроверка' }))
        .status,
    ).toBe(200);
    expect((await protocolAction(h, token, race.raceId, '/protocol/apply-recheck')).status).toBe(
      200,
    );
    const recheck = await resultsDb(h)
      .protocolRows.find({ raceId: race.raceId, revision: 2 })
      .sort({ order: 1 })
      .toArray();
    expect(recheck.map((row) => [row.entryId, row.place, row.status])).toEqual([
      [riders[0]!.entryId, 1, 'final'],
      [riders[2]!.entryId, 2, 'final'],
      [riders[1]!.entryId, null, 'dq'],
    ]);

    // «Отменить DQ» после публикации — строка с местом, revised (RC-3)
    const revoked = await protocolAction(
      h,
      token,
      race.raceId,
      '/protocol/revoke-disqualification',
      {
        entryId: riders[1]!.entryId,
        reason: 'Апелляция',
      },
    );
    expect(revoked.status).toBe(200);
    const revised = await resultsDb(h)
      .protocolRows.find({ raceId: race.raceId, revision: 3 })
      .sort({ order: 1 })
      .toArray();
    expect(revised.map((row) => [row.entryId, row.place, row.status])).toEqual([
      [riders[0]!.entryId, 1, 'final'],
      [riders[1]!.entryId, 2, 'revised'],
      [riders[2]!.entryId, 3, 'revised'],
    ]);
    const after = MyRaceEntry.parse(
      (await call(h, 'GET', entryUrl(race.raceId), undefined, riders[1]!.auth)).body,
    );
    expect(after.result).toMatchObject({ status: 'revised', place: 2 });
    expect(await disputesDb(h).disputes.countDocuments({ status: 'open' })).toBe(0);
  });

  it('решённый спор после публикации — в разборе not_open', async () => {
    const race = await decidable();
    const { token } = await travelFresh(h, new Date(race.filedAt.getTime() + 12 * HOUR), []);
    expect((await decideDispute(h, token, race.id, REJECTED)).status).toBe(200);
    expect((await protocolAction(h, token, race.raceId, '/protocol')).status).toBe(200);
    expect(await panelDispute(h, token, race.id)).toMatchObject({
      canDecide: false,
      decideBlockedBy: 'not_open',
    });
  });
});
