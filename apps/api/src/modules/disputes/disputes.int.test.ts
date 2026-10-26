import { MyDispute, DisputeAgainstMe, minskWallTimeToUtc, PanelRace } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DISPUTE_FILING_CLOSES,
  disputeRace,
  disputesDb,
  disputesUrl,
  fileDispute,
  filedId,
  myDisputes,
  refusal,
  respondDispute,
  travelFresh,
  withdrawDispute,
} from '../../../test/disputes';
import { createHarness, type Harness, HOUR } from '../../../test/harness';
import { call, outboxEvents } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { RACES } from '../../../test/races';
import { protocolAction, resultsDb, rider } from '../../../test/results';

/**
 * Споры приложения (race-results-06: AC1–AC4, лимит, RC-7). Гонка `disputeRace`: окно 24.10–26.10, часы — после срока
 * загрузки (27.10 21:00 UTC), отсечка приёма — 29.10 20:59 UTC.
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

const UNKNOWN = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('подача (AC1)', () => {
  it('201 MyDispute, документ open, событие filed, outbox без текста', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    const [me, rival] = riders;
    const res = await fileDispute(h, me!.auth, raceId, {
      targetEntryId: rival!.entryId,
      category: 'vehicle_assistance',
      description: 'Скорость 70 км/ч на подъёме',
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const dispute = MyDispute.parse(res.body);
    expect(dispute).toMatchObject({
      raceId,
      targetEntryId: rival!.entryId,
      category: 'vehicle_assistance',
      description: 'Скорость 70 км/ч на подъёме',
      status: 'open',
      closedAt: null,
      decision: null,
    });
    expect(Object.keys(res.body as object).sort()).toEqual(Object.keys(dispute).sort());

    const doc = await disputesDb(h).disputes.findOne({ _id: dispute.id });
    expect(doc).toMatchObject({
      raceId,
      groupKey: 'overall',
      complainantUserId: me!.userId,
      complainantEntryId: me!.entryId,
      targetEntryId: rival!.entryId,
      targetUserId: rival!.userId,
      status: 'open',
      response: null,
      decision: null,
      filedAt: h.clock.now(),
      version: 0,
    });
    expect(await disputesDb(h).events.find().toArray()).toMatchObject([
      {
        disputeId: dispute.id,
        raceId,
        kind: 'filed',
        actor: { kind: 'rider', userId: me!.userId },
        payload: {},
      },
    ]);
    const events = (await outboxEvents(h)).filter((event) => event.type.startsWith('disputes.'));
    expect(events.map((event) => [event.type, event.payload])).toEqual([
      ['disputes.dispute-filed', { disputeId: dispute.id, raceId }],
    ]);
  });

  it('без входа — 401; неизвестная гонка — 404; тело строгое (категория обязательна)', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    expect(
      (await call(h, 'POST', disputesUrl(raceId), { targetEntryId: UNKNOWN, category: 'other' }))
        .status,
    ).toBe(401);
    expect(
      (
        await fileDispute(h, riders[0]!.auth, UNKNOWN, {
          targetEntryId: riders[1]!.entryId,
          category: 'other',
        })
      ).status,
    ).toBe(404);
    const invalid = await fileDispute(h, riders[0]!.auth, raceId, {
      targetEntryId: riders[1]!.entryId,
    });
    expect(invalid.status).toBe(400);
    const extra = await fileDispute(h, riders[0]!.auth, raceId, {
      targetEntryId: riders[1]!.entryId,
      category: 'other',
      complainantUserId: UNKNOWN,
    });
    expect(extra.status).toBe(400);
  });
});

describe('отказы подачи (AC2)', () => {
  it('своя заявка, цель без засчитанного, цель DQ, чужой гонки или неизвестная', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, null, 3800]);
    const [me, noBest, dq] = riders;
    await resultsDb(h).entries.updateOne(
      { _id: dq!.entryId },
      { $set: { disqualified: { at: h.clock.now(), disputeId: UNKNOWN } } },
    );
    const file = (targetEntryId: string) =>
      fileDispute(h, me!.auth, raceId, { targetEntryId, category: 'other' });
    expect(refusal(await file(me!.entryId))).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'own_result']);
    for (const target of [noBest!.entryId, dq!.entryId, UNKNOWN]) {
      expect(refusal(await file(target))).toEqual([
        409,
        'DISPUTE_ACTION_BLOCKED',
        'target_not_counted',
      ]);
    }
    expect(await disputesDb(h).disputes.countDocuments()).toBe(0);
  });

  it('заявитель: не заявлен, без засчитанного, отменил участие, DQ', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, null, 3700, 3800]);
    const [target, noBest, withdrawn, dq] = riders;
    await resultsDb(h).entries.updateOne(
      { _id: withdrawn!.entryId },
      { $set: { status: 'withdrawn', withdrawnAt: h.clock.now() } },
    );
    await resultsDb(h).entries.updateOne(
      { _id: dq!.entryId },
      { $set: { disqualified: { at: h.clock.now(), disputeId: UNKNOWN } } },
    );
    const stranger = await rider(h, 'stranger@example.com');
    const body = { targetEntryId: target!.entryId, category: 'other' };
    const cases: [Record<string, string>, string][] = [
      [stranger.auth, 'not_entered'],
      [noBest!.auth, 'no_counted_result'],
      [withdrawn!.auth, 'withdrawn'],
      [dq!.auth, 'disqualified'],
    ];
    for (const [auth, reason] of cases) {
      expect(refusal(await fileDispute(h, auth, raceId, body)), reason).toEqual([
        409,
        'DISPUTE_ACTION_BLOCKED',
        reason,
      ]);
    }
    const mine = await myDisputes(h, stranger.auth, raceId);
    expect(mine.filing).toMatchObject({ status: 'unavailable', reason: 'not_entered' });
  });

  it('после отсечки D-44 — filing_closed (граница включительно); filing.status closed (M1)', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    const { riders: fresh } = await travelFresh(h, DISPUTE_FILING_CLOSES, riders);
    const res = await fileDispute(h, fresh[0]!.auth, raceId, {
      targetEntryId: fresh[1]!.entryId,
      category: 'other',
    });
    expect(refusal(res)).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'filing_closed']);
    expect((await myDisputes(h, fresh[0]!.auth, raceId)).filing).toEqual({
      status: 'closed',
      closesAt: DISPUTE_FILING_CLOSES.toISOString(),
      protocolPlannedAt: new Date(DISPUTE_FILING_CLOSES.getTime() + 24 * HOUR).toISOString(),
      reason: 'filing_closed',
    });
  });

  it('после публикации — protocol_published; отменённая гонка — cancelled', async () => {
    const published = await disputeRace(h, [3600, 3700]);
    expect((await protocolAction(h, published.token, published.raceId, '/protocol')).status).toBe(
      200,
    );
    expect(
      refusal(
        await fileDispute(h, published.riders[0]!.auth, published.raceId, {
          targetEntryId: published.riders[1]!.entryId,
          category: 'other',
        }),
      ),
    ).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'protocol_published']);
    expect((await myDisputes(h, published.riders[0]!.auth, published.raceId)).filing).toMatchObject(
      { status: 'closed', reason: 'protocol_published' },
    );

    await h.reset();
    const race = await disputeRace(h, [3600, 3700]);
    const current = PanelRace.parse(
      (await panelCall(h, race.token, 'GET', `${RACES}/${race.raceId}`)).body,
    );
    const cancelled = await panelCall(h, race.token, 'POST', `${RACES}/${race.raceId}/cancel`, {
      version: current.version,
      reason: 'weather',
    });
    expect(cancelled.status).toBe(200);
    expect(
      refusal(
        await fileDispute(h, race.riders[0]!.auth, race.raceId, {
          targetEntryId: race.riders[1]!.entryId,
          category: 'other',
        }),
      ),
    ).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'cancelled']);
  });

  it('повтор пары — already_filed, и после отзыва (R2)', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    const [me, rival] = riders;
    const file = () =>
      fileDispute(h, me!.auth, raceId, { targetEntryId: rival!.entryId, category: 'other' });
    const first = filedId(await file());
    expect(refusal(await file())).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'already_filed']);
    expect((await withdrawDispute(h, me!.auth, first)).status).toBe(200);
    expect(refusal(await file())).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'already_filed']);
    expect(await disputesDb(h).disputes.countDocuments()).toBe(1);
  });

  it('четвёртый открытый в гонке — open_limit', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700, 3800, 3900, 4000]);
    const [me, ...targets] = riders;
    for (const target of targets.slice(0, 3)) {
      filedId(
        await fileDispute(h, me!.auth, raceId, {
          targetEntryId: target.entryId,
          category: 'other',
        }),
      );
    }
    expect(
      refusal(
        await fileDispute(h, me!.auth, raceId, {
          targetEntryId: targets[3]!.entryId,
          category: 'other',
        }),
      ),
    ).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'open_limit']);
    expect((await myDisputes(h, me!.auth, raceId)).filing).toMatchObject({
      status: 'closed',
      reason: 'open_limit',
    });
  });

  it('две параллельные подачи одной пары — одна 201, вторая already_filed', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    const body = { targetEntryId: riders[1]!.entryId, category: 'other' };
    const results = await Promise.all([
      fileDispute(h, riders[0]!.auth, raceId, body),
      fileDispute(h, riders[0]!.auth, raceId, body),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.map(refusal).find((row) => row[0] === 409)).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'already_filed',
    ]);
    expect(await disputesDb(h).disputes.countDocuments()).toBe(1);
  });
});

describe('видимость D-51 (AC3)', () => {
  it('цель видит только категорию, статус, срок, свой ответ, исход; заявитель — свой спор без ответа; посторонний — 404', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700, 3800]);
    const [me, rival, stranger] = riders;
    const id = filedId(
      await fileDispute(h, me!.auth, raceId, {
        targetEntryId: rival!.entryId,
        category: 'foreign_track',
        description: 'Чужой датчик',
      }),
    );
    expect((await respondDispute(h, rival!.auth, id, 'Это мой заезд')).status).toBe(200);

    const theirs = await myDisputes(h, rival!.auth, raceId);
    expect(theirs.filed).toEqual([]);
    expect(theirs.against).toHaveLength(1);
    const raw = (await call(h, 'GET', disputesUrl(raceId), undefined, rival!.auth)).body as {
      against: Record<string, unknown>[];
    };
    expect(Object.keys(raw.against[0]!).sort()).toEqual(Object.keys(DisputeAgainstMe.shape).sort());
    expect(JSON.stringify(raw)).not.toContain('Чужой датчик');
    expect(JSON.stringify(raw)).not.toContain(me!.userId);
    expect(JSON.stringify(raw)).not.toContain(me!.entryId);
    expect(theirs.against[0]).toMatchObject({
      id,
      category: 'foreign_track',
      status: 'open',
      response: { text: 'Это мой заезд' },
      canRespond: false,
      decision: null,
    });

    const mine = await myDisputes(h, me!.auth, raceId);
    expect(mine.against).toEqual([]);
    const rawMine = (await call(h, 'GET', disputesUrl(raceId), undefined, me!.auth)).body as {
      filed: Record<string, unknown>[];
    };
    expect(Object.keys(rawMine.filed[0]!).sort()).toEqual(Object.keys(MyDispute.shape).sort());
    expect(JSON.stringify(rawMine)).not.toContain('Это мой заезд');
    expect(mine.filed[0]).toMatchObject({ id, description: 'Чужой датчик', status: 'open' });

    expect(refusal(await withdrawDispute(h, stranger!.auth, id))).toEqual([
      404,
      'DISPUTE_NOT_FOUND',
      undefined,
    ]);
    expect(refusal(await respondDispute(h, stranger!.auth, id, 'Посторонний'))).toEqual([
      404,
      'DISPUTE_NOT_FOUND',
      undefined,
    ]);
    expect((await withdrawDispute(h, rival!.auth, UNKNOWN)).status).toBe(404);
  });
});

describe('ответ и отзыв (AC4)', () => {
  it('цель отвечает один раз; после закрытия — not_open; отзыв — только заявитель и только открытого', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    const [me, rival] = riders;
    const id = filedId(
      await fileDispute(h, me!.auth, raceId, { targetEntryId: rival!.entryId, category: 'other' }),
    );
    expect(refusal(await respondDispute(h, me!.auth, id, 'Заявитель'))).toEqual([
      404,
      'DISPUTE_NOT_FOUND',
      undefined,
    ]);
    expect(refusal(await respondDispute(h, rival!.auth, id, 'ок'))).toEqual([
      400,
      'VALIDATION_FAILED',
      undefined,
    ]);
    const answered = await respondDispute(h, rival!.auth, id, '  Мой трек  ');
    expect(answered.status).toBe(200);
    expect(DisputeAgainstMe.parse(answered.body)).toMatchObject({
      response: { text: 'Мой трек' },
      canRespond: false,
    });
    expect(refusal(await respondDispute(h, rival!.auth, id, 'Ещё раз'))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'already_responded',
    ]);

    expect(refusal(await withdrawDispute(h, rival!.auth, id))).toEqual([
      404,
      'DISPUTE_NOT_FOUND',
      undefined,
    ]);
    const withdrawn = await withdrawDispute(h, me!.auth, id);
    expect(withdrawn.status).toBe(200);
    expect(MyDispute.parse(withdrawn.body)).toMatchObject({
      status: 'withdrawn',
      closedAt: h.clock.now().toISOString(),
    });
    expect(refusal(await withdrawDispute(h, me!.auth, id))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'not_open',
    ]);
    expect(
      (await disputesDb(h).events.find({ disputeId: id }).sort({ at: 1, _id: 1 }).toArray()).map(
        (event) => [event.kind, event.actor.kind],
      ),
    ).toEqual([
      ['filed', 'rider'],
      ['responded', 'rider'],
      ['withdrawn', 'rider'],
    ]);
    const events = (await outboxEvents(h)).filter((event) => event.type.startsWith('disputes.'));
    expect(events.map((event) => event.type)).toEqual([
      'disputes.dispute-filed',
      'disputes.dispute-responded',
      'disputes.dispute-withdrawn',
    ]);
    expect(JSON.stringify(events)).not.toContain('Мой трек');
  });

  it('ответ на закрытый спор — not_open', async () => {
    const { raceId, riders } = await disputeRace(h, [3600, 3700]);
    const [me, rival] = riders;
    const id = filedId(
      await fileDispute(h, me!.auth, raceId, { targetEntryId: rival!.entryId, category: 'other' }),
    );
    expect((await withdrawDispute(h, me!.auth, id)).status).toBe(200);
    expect(refusal(await respondDispute(h, rival!.auth, id, 'Поздно'))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'not_open',
    ]);
    expect((await myDisputes(h, rival!.auth, raceId)).against[0]).toMatchObject({
      status: 'withdrawn',
      canRespond: false,
    });
  });
});

describe('лимит и отсечка', () => {
  it('21-я мутация за час — 429 RATE_LIMITED', async () => {
    const { riders } = await disputeRace(h, [3600]);
    for (let index = 0; index < 20; index += 1) {
      expect((await withdrawDispute(h, riders[0]!.auth, UNKNOWN)).status).toBe(404);
    }
    expect((await withdrawDispute(h, riders[0]!.auth, UNKNOWN)).status).toBe(429);
  });

  it('RC-7: перенос плановой даты позже после отсечки — приём не открывается', async () => {
    const { raceId, riders, token } = await disputeRace(h, [3600, 3700]);
    const { riders: fresh, token: admin } = await travelFresh(
      h,
      new Date(DISPUTE_FILING_CLOSES.getTime() + HOUR),
      riders,
    );
    expect(token).toBeTruthy();
    const current = PanelRace.parse((await panelCall(h, admin, 'GET', `${RACES}/${raceId}`)).body);
    const moved = await panelCall(h, admin, 'POST', `${RACES}/${raceId}`, {
      version: current.version,
      protocolPlannedAt: minskWallTimeToUtc('2026-11-03T23:59'),
    });
    expect(moved.status).toBe(200);
    expect((await myDisputes(h, fresh[0]!.auth, raceId)).filing).toMatchObject({
      status: 'closed',
      closesAt: DISPUTE_FILING_CLOSES.toISOString(),
      reason: 'filing_closed',
    });
    expect(
      refusal(
        await fileDispute(h, fresh[0]!.auth, raceId, {
          targetEntryId: fresh[1]!.entryId,
          category: 'other',
        }),
      ),
    ).toEqual([409, 'DISPUTE_ACTION_BLOCKED', 'filing_closed']);
  });
});
