import { RideParticipants } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { patchProfile, type PublicRider, publicRider } from '../../../test/profiles';
import { signIn } from '../../../test/results';
import { authed, hideInDb, type Rider, rider } from '../../../test/rides';
import { pastRide, socialDb, socialServices } from '../../../test/social';

/**
 * «Спасибо за компанию» по HTTP (P4, AC1–AC3): одному явившемуся публичному и «Поблагодарить всех» (включая
 * непубличных, Q1), повтор — no-op, отказы P0 (`409 self` / `not_attended`), `404` — неизвестный `publicId` и скрытый
 * райд, лимит `social-thanks` — первой проверкой.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const url = (id: string) => `/v1/rides/${id}/thanks`;
const thank = (who: Rider, id: string, body: unknown = {}) => authed(h, who, 'POST', url(id), body);
const blocked = (reason: string) => ({ code: 'SOCIAL_ACTION_BLOCKED', details: { reason } });

/** После сдвига часов access истекает — новый вход по паролю. */
async function fresh<T extends Rider>(who: T, email: string): Promise<T> {
  const auth = await signIn(h, email);
  return { ...who, token: (auth.authorization ?? '').replace('Bearer ', '') };
}

/** Прошедший райд: организатор и Анна, Борис (публичные), «тихий» (без имени) явились; Вера — «Иду» без явки. */
async function ride() {
  const org = await publicRider(h, 'org@example.by', 'Организатор');
  const anna = await publicRider(h, 'anna@example.by', 'Анна К.');
  const boris = await publicRider(h, 'boris@example.by', 'Борис Л.');
  const vera = await publicRider(h, 'vera@example.by', 'Вера М.');
  const quiet = await rider(h, 'quiet@example.by');
  const past = await pastRide(h, org, [anna, boris, quiet, vera]);
  for (const who of [org, anna, boris, quiet])
    await socialServices(h).attendance.markManual(who.userId, past.id);
  return {
    id: past.id,
    org: await fresh(org, 'org@example.by'),
    anna: await fresh(anna, 'anna@example.by'),
    boris,
    vera: await fresh(vera, 'vera@example.by'),
    quiet,
  };
}

function participantsOf(res: { status: number; body: unknown; headers: Record<string, unknown> }) {
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(res.body)).not.toContain('userId');
  return RideParticipants.parse(res.body);
}
const rowOf = (view: RideParticipants, who: PublicRider) =>
  view.attendance?.attended?.riders.find((row) => row.publicId === who.publicId);

describe('одному (AC1)', () => {
  it('явившемуся публичному — `thanked`; повтор — no-op; своя строка — `self`; всех ещё нет', async () => {
    const { id, org, anna, boris, quiet } = await ride();
    const first = participantsOf(await thank(org, id, { publicId: anna.publicId }));
    expect(rowOf(first, anna)).toMatchObject({ thanked: true, self: false });
    expect(rowOf(first, boris)).toMatchObject({ thanked: false, self: false });
    expect(rowOf(first, org)).toMatchObject({ self: true, thanked: false });
    expect(first.attendance?.allThanked).toBe(false);
    expect(first.riders.every((row) => !('thanked' in row))).toBe(true);

    const again = participantsOf(await thank(org, id, { publicId: anna.publicId }));
    expect(rowOf(again, anna)?.thanked).toBe(true);
    expect(await socialDb(h).reactions.countDocuments({ actorId: org.userId })).toBe(1);
    expect(await socialDb(h).events.countDocuments({ type: 'thanks-sent' })).toBe(1);
    const text = JSON.stringify(again);
    for (const who of [org, anna, boris, quiet]) expect(text).not.toContain(who.userId);
  });
});

describe('«Поблагодарить всех» (AC2, Q1)', () => {
  it('всем явившимся, включая непубличных, кроме себя; `allThanked`; повтор — ничего', async () => {
    const { id, org, anna, boris, quiet, vera } = await ride();
    expect((await thank(org, id, { publicId: anna.publicId })).status).toBe(200);
    const all = participantsOf(await thank(org, id));
    expect(all.attendance?.allThanked).toBe(true);
    expect(rowOf(all, boris)?.thanked).toBe(true);
    const recipients = async () =>
      (await socialDb(h).reactions.find({ actorId: org.userId }).toArray())
        .map((doc) => doc.recipientId)
        .sort();
    expect(await recipients()).toEqual([anna.userId, boris.userId, quiet.userId].sort());
    expect(await recipients()).not.toContain(vera.userId);

    const again = participantsOf(await authed(h, org, 'POST', url(id)));
    expect(again.attendance?.allThanked).toBe(true);
    expect(await recipients()).toHaveLength(3);
    expect(await socialDb(h).events.countDocuments({ type: 'thanks-sent' })).toBe(3);
  });
});

describe('отказы (AC3)', () => {
  it('зритель без явки, получатель без явки — 409 not_attended; себе — 409 self', async () => {
    const { id, org, anna, vera } = await ride();
    expect((await thank(vera, id, { publicId: anna.publicId })).body).toMatchObject(
      blocked('not_attended'),
    );
    expect((await thank(vera, id)).body).toMatchObject(blocked('not_attended'));
    const toAbsent = await thank(org, id, { publicId: vera.publicId });
    expect(toAbsent.status).toBe(409);
    expect(toAbsent.body).toMatchObject(blocked('not_attended'));
    expect((await thank(org, id, { publicId: org.publicId })).body).toMatchObject(blocked('self'));
    expect(await socialDb(h).reactions.countDocuments()).toBe(0);
  });

  it('неизвестный и непубличный `publicId` — 404; скрытый райд не организатору — 404', async () => {
    const { id, org, anna } = await ride();
    expect((await thank(org, id, { publicId: 'z'.repeat(43) })).status).toBe(404);
    await patchProfile(h, anna, { showNameInResults: false });
    expect((await thank(org, id, { publicId: anna.publicId })).status).toBe(404);
    expect((await thank(org, uuidv7())).status).toBe(404);
    await hideInDb(h, id);
    expect((await thank(anna, id)).status).toBe(404);
    // организатору скрытый виден: отказ — уже от P0 (явка есть — «спасибо» Анне проходит)
    expect((await thank(org, id)).status).toBe(200);
  });

  it('гость — 401; лишнее поле и неверный `publicId` — 400; невалидный id — 400', async () => {
    const { id, org } = await ride();
    expect((await call(h, 'POST', url(id), {})).status).toBe(401);
    expect((await thank(org, id, { publicId: 'z'.repeat(43), userId: 'x' })).status).toBe(400);
    expect((await thank(org, id, { publicId: 'short' })).status).toBe(400);
    expect((await thank(org, 'not-a-uuid')).status).toBe(400);
  });

  it('лимит: 60 попыток проходят, 61-я — 429 первой проверкой (до 404)', async () => {
    const { org } = await ride();
    for (let index = 0; index < 60; index += 1) {
      expect((await thank(org, uuidv7())).status).toBe(404);
    }
    const limited = await thank(org, uuidv7());
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
