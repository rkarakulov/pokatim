import { RideCard, RiderSocial, SocialConnections } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import { bearer, call, type CallResult } from '../../../test/identity';
import { patchProfile, type PublicRider, publicRider, seedAvatar } from '../../../test/profiles';
import { signIn } from '../../../test/results';
import { createRide, hideInDb, join, rider, ridesDb, startsIn } from '../../../test/rides';
import { pastRide, socialDb, socialServices, travelPast } from '../../../test/social';

/**
 * «Свои» на профиле райдера (P3, AC1–AC3): `GET riders/:publicId/social`, `PUT …/social/connection {connected}`,
 * `GET social/connections` — `AuthGuard`, `no-store`; непубличный и неизвестный — один `404`; себе — `409 self`;
 * «Идёт» — только при связи райдер → зритель; лимит K11; убранная связь не возвращается пересчётом явки (K1).
 */
let h: Harness;
let viewer: PublicRider;
let target: PublicRider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  viewer = await publicRider(h, 'viewer@example.by', 'Вера З.');
  target = await publicRider(h, 'target@example.by', 'Тимур Р.');
});
afterAll(async () => {
  await h.close();
});

const auth = (token: string | undefined) => (token ? bearer(token) : {});
const getSocial = (token: string | undefined, publicId: string) =>
  call(h, 'GET', `/v1/riders/${publicId}/social`, undefined, auth(token));
const putConnection = (
  token: string | undefined,
  publicId: string,
  body: unknown,
): Promise<CallResult> =>
  call(h, 'PUT', `/v1/riders/${publicId}/social/connection`, body, auth(token));
const listConnections = (token: string | undefined) =>
  call(h, 'GET', '/v1/social/connections', undefined, auth(token));

/** Ответ проходит контракт и не несёт лишних полей (strict на верхнем уровне и в карточке «Идёт»). */
function riderSocialOf(res: CallResult): RiderSocial {
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  const parsed = RiderSocial.strict().parse(res.body);
  const going = (res.body as { going?: unknown }).going;
  if (going) RideCard.strict().parse(going);
  return parsed;
}

/** Новый access после перевода часов (access живёт 15 мин). */
async function tokenOf(email: string): Promise<string> {
  const { authorization } = await signIn(h, email);
  return authorization?.replace('Bearer ', '') ?? '';
}

const manualEvents = () =>
  socialDb(h).events.countDocuments({ type: 'connection-created', props: { source: 'manual' } });

describe('доступ и 404 (AC1, AC2)', () => {
  it('без токена — 401 на все три', async () => {
    expect((await getSocial(undefined, target.publicId)).status).toBe(401);
    expect((await putConnection(undefined, target.publicId, { connected: true })).status).toBe(401);
    expect((await listConnections(undefined)).status).toBe(401);
  });

  it('неизвестный и с отозванным согласием — одинаковый 404 (GET и PUT) с no-store, связи нет', async () => {
    const revoked = await publicRider(h, 'revoked@example.by', 'Борис Л.');
    await patchProfile(h, revoked, { showNameInResults: false });
    for (const publicId of [revoked.publicId, 'z'.repeat(43)]) {
      for (const res of [
        await getSocial(viewer.token, publicId),
        await putConnection(viewer.token, publicId, { connected: true }),
        await putConnection(viewer.token, publicId, { connected: false }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
    expect(await socialDb(h).connections.countDocuments()).toBe(0);
  });

  it('свой publicId — self: true, остальное пустое; PUT себе — 409 self, документов нет', async () => {
    expect(riderSocialOf(await getSocial(viewer.token, viewer.publicId))).toEqual({
      self: true,
      connected: false,
      together: { rideCount: 0, lastRideAt: null },
      going: null,
    });
    for (const connected of [true, false]) {
      const res = await putConnection(viewer.token, viewer.publicId, { connected });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'SOCIAL_ACTION_BLOCKED',
        details: { reason: 'self' },
      });
    }
    expect(await socialDb(h).connections.countDocuments()).toBe(0);
  });

  it.each([[{}], [{ connected: 'yes' }], [{ connected: true, extra: 1 }]])(
    'тело %j — 400',
    async (body) => {
      const res = await putConnection(viewer.token, target.publicId, body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});

describe('«В свои» / «Убрать» (AC2, K1, K11)', () => {
  it('true → connected, повтор — 200 без второго события; false → убрано, повтор — 200', async () => {
    expect(
      riderSocialOf(await putConnection(viewer.token, target.publicId, { connected: true })),
    ).toMatchObject({ self: false, connected: true });
    expect(
      riderSocialOf(await putConnection(viewer.token, target.publicId, { connected: true }))
        .connected,
    ).toBe(true);
    expect(await manualEvents()).toBe(1);
    // связь только от нажавшего (K1)
    expect(await socialDb(h).connections.countDocuments({ ownerId: target.userId })).toBe(0);

    for (let index = 0; index < 2; index += 1) {
      expect(
        riderSocialOf(await putConnection(viewer.token, target.publicId, { connected: false })),
      ).toMatchObject({ connected: false });
    }
    expect(riderSocialOf(await getSocial(viewer.token, target.publicId)).connected).toBe(false);
  });

  it('31-я попытка «В свои» за сутки — 429 RATE_LIMITED; «Убрать» лимитом не считается', async () => {
    for (let index = 0; index < 30; index += 1) {
      expect((await putConnection(viewer.token, target.publicId, { connected: true })).status).toBe(
        200,
      );
    }
    expect((await putConnection(viewer.token, target.publicId, { connected: false })).status).toBe(
      200,
    );
    const limited = await putConnection(viewer.token, target.publicId, { connected: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('together после общего райда; после «Убрать» — тот же, connected false; пересчёт явки связь не возвращает', async () => {
    const ride = await pastRide(h, target, [viewer]);
    const { attendance } = socialServices(h);
    await attendance.markManual(target.userId, ride.id);
    await attendance.markManual(viewer.userId, ride.id);
    const token = await tokenOf('viewer@example.by');
    const together = { rideCount: 1, lastRideAt: ride.startsAt.toISOString() };
    expect(riderSocialOf(await getSocial(token, target.publicId))).toMatchObject({
      connected: true,
      together,
    });

    expect(
      riderSocialOf(await putConnection(token, target.publicId, { connected: false })),
    ).toMatchObject({ connected: false, together });
    await attendance.unmark(viewer.userId, ride.id);
    await attendance.markManual(viewer.userId, ride.id);
    expect(riderSocialOf(await getSocial(token, target.publicId))).toMatchObject({
      connected: false,
      together,
    });
    const list = SocialConnections.parse((await listConnections(token)).body);
    expect(list).toEqual({ items: [], count: 0 });
  });
});

describe('«Идёт» (AC1, K6)', () => {
  it('ближайший будущий райд райдера — только при связи райдер → зритель; роль зрителя; без лишних полей', async () => {
    const org = await rider(h, 'org@example.by');
    // раньше нужного: отменённый, скрытый и прошедший — пропускаются
    const cancelled = await createRide(h, org, { startsAt: startsIn(h, 2 * HOUR) });
    const hidden = await createRide(h, org, { startsAt: startsIn(h, 3 * HOUR) });
    const past = await createRide(h, org, { startsAt: startsIn(h, 4 * HOUR) });
    const early = await createRide(h, org, { startsAt: startsIn(h, DAY) });
    for (const ride of [cancelled, hidden, past, early]) {
      expect((await join(h, target, ride.id)).status).toBe(200);
    }
    await ridesDb(h).updateOne({ _id: cancelled.id }, { $set: { status: 'cancelled' } });
    await hideInDb(h, hidden.id);
    await ridesDb(h).updateOne(
      { _id: past.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - HOUR) } },
    );
    await createRide(h, target, { startsAt: startsIn(h, 2 * DAY) });

    // без связи райдер → зритель — null; только зритель → райдер — тоже null
    expect(riderSocialOf(await getSocial(viewer.token, target.publicId)).going).toBeNull();
    await putConnection(viewer.token, target.publicId, { connected: true });
    expect(riderSocialOf(await getSocial(viewer.token, target.publicId)).going).toBeNull();

    // райдер добавил зрителя — карточка раннего
    await putConnection(target.token, viewer.publicId, { connected: true });
    const going = riderSocialOf(await getSocial(viewer.token, target.publicId)).going;
    expect(going).toMatchObject({
      id: early.id,
      phase: 'upcoming',
      viewer: { role: 'none', canJoin: true },
    });
    const raw = JSON.stringify((await getSocial(viewer.token, target.publicId)).body);
    for (const id of [org.userId, target.userId, viewer.userId]) expect(raw).not.toContain(id);
    expect(raw).not.toContain('participants');

    // зритель записан — participant, canJoin false
    expect((await join(h, viewer, early.id)).status).toBe(200);
    expect(riderSocialOf(await getSocial(viewer.token, target.publicId)).going).toMatchObject({
      id: early.id,
      viewer: { role: 'participant', canJoin: false },
    });

    // райдер убрал зрителя — null
    await putConnection(target.token, viewer.publicId, { connected: false });
    expect(riderSocialOf(await getSocial(viewer.token, target.publicId)).going).toBeNull();
  });
});

describe('GET social/connections (AC3, RC-P3-9, RC-P3-11)', () => {
  it('порядок, только публичные и не убранные, источники, без userId', async () => {
    const [anna, boris, quiet, gone] = [
      await publicRider(h, 'anna@example.by', 'Анна К.'),
      await publicRider(h, 'boris@example.by', 'Борис Л.'),
      await rider(h, 'quiet@example.by'),
      await publicRider(h, 'gone@example.by', 'Галя Д.'),
    ];
    const avatar = await seedAvatar(h, boris.userId);
    const { attendance, connections } = socialServices(h);
    // райд с Анной раньше, с Борисом позже; Тимур — вручную без райдов, Тихий — по приглашению
    const first = await createRide(h, anna, { limit: null, startsAt: startsIn(h, DAY) });
    const second = await createRide(h, boris, { limit: null, startsAt: startsIn(h, 2 * DAY) });
    for (const ride of [first, second]) expect((await join(h, viewer, ride.id)).status).toBe(200);
    travelPast(h, new Date(first.startsAt));
    await attendance.markManual(viewer.userId, first.id);
    await attendance.markManual(anna.userId, first.id);
    travelPast(h, new Date(second.startsAt));
    await attendance.markManual(viewer.userId, second.id);
    await attendance.markManual(boris.userId, second.id);
    await connections.addManual(viewer.userId, target.userId);
    h.clock.advance(1000);
    await connections.addManual(viewer.userId, anna.userId);
    await connections.linkInvite(gone.userId, viewer.userId);
    await connections.remove(viewer.userId, gone.userId);
    h.clock.advance(1000);
    await connections.linkInvite(quiet.userId, viewer.userId);
    const token = await tokenOf('viewer@example.by');

    const res = await listConnections(token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(SocialConnections.parse(res.body)).toEqual({
      items: [
        {
          publicId: boris.publicId,
          name: 'Борис Л.',
          avatar: { id: avatar.id },
          rideCount: 1,
          lastRideAt: new Date(second.startsAt).toISOString(),
          sources: ['ride'],
        },
        {
          publicId: anna.publicId,
          name: 'Анна К.',
          avatar: null,
          rideCount: 1,
          lastRideAt: new Date(first.startsAt).toISOString(),
          sources: ['ride', 'manual'],
        },
        {
          publicId: target.publicId,
          name: 'Тимур Р.',
          avatar: null,
          rideCount: 0,
          lastRideAt: null,
          sources: ['manual'],
        },
      ],
      count: 3,
    });
    const raw = JSON.stringify(res.body);
    for (const who of [viewer, target, anna, boris, quiet, gone]) {
      expect(raw).not.toContain(who.userId);
    }

    // непубличный по приглашению стал публичным — в списке выше Тимура (изменён позже), источник invite
    await patchProfile(
      h,
      { ...quiet, token: await tokenOf('quiet@example.by') },
      { publicName: 'Тихий Р.', showNameInResults: true },
    );
    const after = SocialConnections.parse((await listConnections(token)).body);
    expect(after.count).toBe(4);
    expect(after.items.map((row) => row.name)).toEqual([
      'Борис Л.',
      'Анна К.',
      'Тихий Р.',
      'Тимур Р.',
    ]);
    expect(after.items[2]).toMatchObject({ sources: ['invite'] });
  });
});
