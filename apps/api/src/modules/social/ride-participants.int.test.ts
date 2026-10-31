import { RideParticipants } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import { publicRider } from '../../../test/profiles';
import { signIn } from '../../../test/results';
import { authed, hideInDb, type Rider } from '../../../test/rides';
import { DAY, HOUR, pastRide, riders, ridesAhead, socialDb } from '../../../test/social';

/**
 * Участники райда и ручная явка по HTTP (P2, AC1–AC3): видимость скрытого (RC-1), публичные карточки без `userId`,
 * флаги окна (RC-3), идемпотентность, пересчёт связей и лимит `social-attendance` (RC-2).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const url = (id: string, suffix = 'participants') => `/v1/rides/${id}/${suffix}`;
const MARK = 'attendance';
const DECLINE = 'attendance/decline';
const emailOf: Record<string, string> = {};

/** После сдвига часов access истекает — новый вход по паролю. */
async function relogin(who: Rider, email: string): Promise<Rider> {
  const auth = await signIn(h, email);
  return { ...who, token: (auth.authorization ?? '').replace('Bearer ', '') };
}

async function named<const N extends readonly string[]>(...names: N) {
  const list = await riders(h, ...names);
  (list as readonly Rider[]).forEach((who, index) => {
    emailOf[who.userId] = `${names[index]}@example.by`;
  });
  return list;
}
const fresh = (who: Rider) => relogin(who, emailOf[who.userId] ?? '');

const get = (who: Rider, id: string) => authed(h, who, 'GET', url(id));
const post = (who: Rider, id: string, suffix: string) =>
  authed(h, who, 'POST', url(id, suffix), {});
const blocked = (reason: string) => ({ code: 'SOCIAL_ACTION_BLOCKED', details: { reason } });

describe('доступ и видимость (AC1, RC-1)', () => {
  it('гость — 401; невалидный id — 400; неизвестный — 404; no-store', async () => {
    const [org] = await named('org');
    const [ride] = await ridesAhead(h, org, [], 1);
    if (!ride) throw new Error('нет райда');
    for (const suffix of ['participants', MARK, DECLINE]) {
      const method = suffix === 'participants' ? 'GET' : 'POST';
      expect(
        (await call(h, method, url(ride.id, suffix), method === 'POST' ? {} : undefined)).status,
      ).toBe(401);
      expect((await authed(h, org, method, url('not-a-uuid', suffix), {})).status).toBe(400);
      expect((await authed(h, org, method, url(uuidv7(), suffix), {})).status).toBe(404);
    }
    const res = await get(org, ride.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('скрытый: участнику и чужому — 404 (GET и оба POST); организатору — 200, его POST — 409 ride_unavailable', async () => {
    const [org, member, outsider] = await named('org', 'member', 'outsider');
    const ride = await pastRide(h, org, [member]);
    await hideInDb(h, ride.id);
    const [o, m, x] = [await fresh(org), await fresh(member), await fresh(outsider)];
    for (const who of [m, x]) {
      expect((await get(who, ride.id)).status).toBe(404);
      expect((await post(who, ride.id, MARK)).status).toBe(404);
      expect((await post(who, ride.id, DECLINE)).status).toBe(404);
    }
    const view = await get(o, ride.id);
    expect(view.status).toBe(200);
    expect(RideParticipants.parse(view.body).attendance).toMatchObject({
      state: 'none',
      canMark: false,
      canDecline: false,
    });
    const marked = await post(o, ride.id, MARK);
    expect(marked.status).toBe(409);
    expect(marked.body).toMatchObject(blocked('ride_unavailable'));
  });
});

describe('участники: публичные карточкой, остальные числом (AC1, K3)', () => {
  it('организатор первым, `hiddenCount`, в JSON нет `userId`; не участнику — attendance: null', async () => {
    const org = await publicRider(h, 'org@example.by', 'Организатор');
    const anna = await publicRider(h, 'anna@example.by', 'Анна К.');
    const [quiet, outsider] = await named('quiet', 'outsider');
    const [ride] = await ridesAhead(h, org, [quiet, anna], 1);
    if (!ride) throw new Error('нет райда');
    const res = await get(outsider, ride.id);
    expect(res.status).toBe(200);
    const body = RideParticipants.parse(res.body);
    expect(body.riders).toEqual([
      { name: 'Организатор', publicId: org.publicId, avatar: null },
      { name: 'Анна К.', publicId: anna.publicId, avatar: null },
    ]);
    expect(body.hiddenCount).toBe(1);
    expect(body.attendance).toBe(null);
    const text = JSON.stringify(res.body);
    for (const who of [org, anna, quiet, outsider]) expect(text).not.toContain(who.userId);
    expect(text).not.toContain('userId');
  });
});

describe('явка: отказы и окно (AC2, RC-3)', () => {
  it('не участник — 409 not_participant; будущий райд — 409 attendance_window', async () => {
    const [org, member, outsider] = await named('org', 'member', 'outsider');
    const [ride] = await ridesAhead(h, org, [member], 1);
    if (!ride) throw new Error('нет райда');
    expect((await post(outsider, ride.id, MARK)).body).toMatchObject(blocked('not_participant'));
    expect((await post(member, ride.id, MARK)).body).toMatchObject(blocked('attendance_window'));
    const view = RideParticipants.parse((await get(member, ride.id)).body);
    expect(view.attendance).toEqual({
      state: 'none',
      canMark: false,
      canDecline: false,
      attended: null,
    });
  });

  it('отменённый — 409 ride_unavailable', async () => {
    const [org, member] = await named('org', 'member');
    const [ride] = await ridesAhead(h, org, [member], 1);
    if (!ride) throw new Error('нет райда');
    const cancelled = await authed(h, org, 'POST', `/v1/rides/${ride.id}/cancel`, {
      reason: 'weather',
    });
    expect(cancelled.status).toBe(200);
    h.clock.advance(DAY + HOUR);
    const m = await fresh(member);
    const res = await post(m, ride.id, MARK);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject(blocked('ride_unavailable'));
  });

  it('границы окна: старт — можно; +7 дн — можно; +7 дн +1 мс — 409 attendance_window', async () => {
    const [org, member] = await named('org', 'member');
    const ride = await pastRide(h, org, [member], 0);
    let m = await fresh(member);
    expect(RideParticipants.parse((await get(m, ride.id)).body).attendance).toMatchObject({
      canMark: true,
      canDecline: true,
    });
    h.clock.advance(7 * DAY);
    m = await fresh(member);
    expect((await post(m, ride.id, MARK)).status).toBe(200);
    h.clock.advance(1);
    const late = await post(m, ride.id, DECLINE);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject(blocked('attendance_window'));
    expect(RideParticipants.parse((await get(m, ride.id)).body).attendance).toMatchObject({
      state: 'attended',
      canMark: false,
      canDecline: false,
    });
  });
});

describe('«Я был» / «Меня не было» (AC3)', () => {
  it('«Я был» → attended с «Ехали N»; повтор — тот же ответ, событие одно; «не был» → declined; снова «был»', async () => {
    const org = await publicRider(h, 'org@example.by', 'Организатор');
    const [member, quiet] = await named('member', 'quiet');
    emailOf[org.userId] = 'org@example.by';
    const ride = await pastRide(h, org, [member, quiet]);
    const [o, m] = [await fresh(org), await fresh(member)];
    expect((await post(o, ride.id, MARK)).status).toBe(200);

    const first = await post(m, ride.id, MARK);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const marked = RideParticipants.parse(first.body);
    expect(marked.attendance).toEqual({
      state: 'attended',
      canMark: false,
      canDecline: true,
      attended: {
        riders: [{ name: 'Организатор', publicId: org.publicId, avatar: null }],
        hiddenCount: 1,
      },
    });
    const again = await post(m, ride.id, MARK);
    expect(again.body).toEqual(first.body);
    expect(
      await socialDb(h).events.countDocuments({ type: 'attendance-marked', userId: member.userId }),
    ).toBe(1);

    const declined = RideParticipants.parse((await post(m, ride.id, DECLINE)).body);
    expect(declined.attendance).toEqual({
      state: 'declined',
      canMark: true,
      canDecline: false,
      attended: null,
    });
    const back = RideParticipants.parse((await post(m, ride.id, MARK)).body);
    expect(back.attendance?.state).toBe('attended');
  });

  it('связи: «Я был» A и B — пары A→B и B→A; «Меня не было» A — пар нет', async () => {
    const [org, a, b] = await named('org', 'a', 'b');
    const ride = await pastRide(h, org, [a, b]);
    const [fa, fb] = [await fresh(a), await fresh(b)];
    expect((await post(fa, ride.id, MARK)).status).toBe(200);
    expect((await post(fb, ride.id, MARK)).status).toBe(200);
    const pairs = () =>
      socialDb(h)
        .connections.find({ ownerId: { $in: [a.userId, b.userId] }, 'rides.0': { $exists: true } })
        .map((doc) => `${doc.ownerId}>${doc.otherId}`)
        .toArray();
    expect((await pairs()).sort()).toEqual(
      [`${a.userId}>${b.userId}`, `${b.userId}>${a.userId}`].sort(),
    );
    expect((await post(fa, ride.id, DECLINE)).status).toBe(200);
    expect(await pairs()).toEqual([]);
  });

  it('лимит: 60 попыток проходят, 61-я — 429 (общий для «Я был» и «Меня не было»)', async () => {
    const [org, outsider] = await named('org', 'outsider');
    const ride = await pastRide(h, org, []);
    const x = await fresh(outsider);
    for (let index = 0; index < 60; index += 1) {
      const res = await post(x, ride.id, index % 2 === 0 ? MARK : DECLINE);
      expect(res.status).toBe(409);
    }
    const limited = await post(x, ride.id, MARK);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    // GET участников лимита не имеет
    expect((await call(h, 'GET', url(ride.id), undefined, bearer(x.token))).status).toBe(200);
  });
});
