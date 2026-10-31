import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { gate, retried, untilBlocked } from '../../../test/identity';
import { patchProfile, publicRider } from '../../../test/profiles';
import { rider } from '../../../test/rides';
import { pastRide, ridesAhead, socialDb, socialServices, travelPast } from '../../../test/social';
import { ConnectionsRepository } from './connections.repository';

/**
 * Связи «Свои» (K1, K3, K9, K11, AC2): ручное «В свои» с лимитом 30/24 ч, нельзя себя и непубличного, тихое
 * удаление (надгробие против пересчёта), связь по приглашению, список владельца и «вместе ехали».
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

const svc = () => socialServices(h).connections;
const attendance = () => socialServices(h).attendance;

describe('ручное «В свои» (K1, K11, RC-16)', () => {
  it('30 добавлений за сутки — можно, 31-е — RATE_LIMITED (лимит считает и отказы)', async () => {
    const owner = await rider(h, 'owner@example.by');
    const target = await publicRider(h, 'target@example.by');
    expect(await svc().addManual(owner.userId, target.userId)).toBe(true);
    for (let index = 1; index < 30; index += 1) {
      expect(await svc().addManual(owner.userId, target.userId)).toBe(false);
    }
    await expect(svc().addManual(owner.userId, target.userId)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    // лимит — на владельца: другой райдер добавляет
    const other = await rider(h, 'other@example.by');
    expect(await svc().addManual(other.userId, target.userId)).toBe(true);
    expect(
      await socialDb(h).events.countDocuments({
        type: 'connection-created',
        props: { source: 'manual' },
      }),
    ).toBe(2);
  });

  it('себя — self; непубличный, неизвестный — одинаковый NOT_FOUND', async () => {
    const owner = await publicRider(h, 'owner@example.by');
    const hidden = await rider(h, 'hidden@example.by');
    await expect(svc().addManual(owner.userId, owner.userId)).rejects.toMatchObject({
      code: 'SOCIAL_ACTION_BLOCKED',
      details: { reason: 'self' },
    });
    for (const otherId of [hidden.userId, uuidv7()]) {
      await expect(svc().addManual(owner.userId, otherId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    expect(await socialDb(h).connections.countDocuments()).toBe(0);
  });

  it('только от нажавшего, без обратной связи (K1)', async () => {
    const owner = await rider(h, 'owner@example.by');
    const target = await publicRider(h, 'target@example.by');
    await svc().addManual(owner.userId, target.userId);
    expect(await socialDb(h).connections.findOne({ ownerId: target.userId })).toBeNull();
    expect(await svc().listOf(owner.userId)).toMatchObject([
      { otherId: target.userId, sources: ['manual'], rideCount: 0, lastRideAt: null },
    ]);
  });
});

describe('тихое удаление (K1, RC-6)', () => {
  it('удалённый скрыт, пересчёт явки его не возвращает; ручное добавление возвращает', async () => {
    const a = await publicRider(h, 'a@example.by', 'Анна К.');
    const b = await publicRider(h, 'b@example.by', 'Борис Л.');
    const ride = await pastRide(h, a, [b]);
    await attendance().markManual(a.userId, ride.id);
    await attendance().markManual(b.userId, ride.id);
    expect((await svc().listOf(a.userId)).map((row) => row.otherId)).toEqual([b.userId]);

    await svc().remove(a.userId, b.userId);
    expect(await svc().listOf(a.userId)).toEqual([]);
    // пересчёт явки (снятие и повторная отметка B) не сбрасывает removedAt
    await attendance().unmark(b.userId, ride.id);
    await attendance().markManual(b.userId, ride.id);
    expect(await svc().listOf(a.userId)).toEqual([]);
    expect(await svc().listOf(b.userId)).toHaveLength(1);
    expect(await svc().togetherOf(a.userId, b.userId)).toEqual({
      rideCount: 1,
      lastRideAt: ride.startsAt,
    });

    expect(await svc().addManual(a.userId, b.userId)).toBe(false);
    expect(await svc().listOf(a.userId)).toMatchObject([
      { otherId: b.userId, sources: ['ride', 'manual'], rideCount: 1 },
    ]);
    // повторное удаление ручной связи снимает и manualAt; повтор — no-op
    await svc().remove(a.userId, b.userId);
    await svc().remove(a.userId, b.userId);
    expect(await socialDb(h).connections.findOne({ ownerId: a.userId })).toMatchObject({
      manualAt: null,
      removedAt: expect.any(Date),
    });
  });

  it('«Убрать» после того, как пересчёт удалил документ пары, ставит надгробие — следующий райд не возвращает', async () => {
    const a = await publicRider(h, 'a@example.by', 'Анна К.');
    const b = await publicRider(h, 'b@example.by', 'Борис Л.');
    const [first, second] = await ridesAhead(h, a, [b], 2);
    if (!first || !second) throw new Error('нет райдов');
    travelPast(h, first.startsAt);
    await attendance().markManual(a.userId, first.id);
    await attendance().markManual(b.userId, first.id);
    // гонка: снятие явки удалило документ без источников раньше, чем дошло «Убрать»
    await attendance().unmark(b.userId, first.id);
    expect(
      await socialDb(h).connections.findOne({ ownerId: a.userId, otherId: b.userId }),
    ).toBeNull();

    await svc().remove(a.userId, b.userId);
    await svc().remove(a.userId, b.userId);
    expect(
      await socialDb(h).connections.countDocuments({ ownerId: a.userId, otherId: b.userId }),
    ).toBe(1);

    travelPast(h, second.startsAt);
    await attendance().markManual(a.userId, second.id);
    await attendance().markManual(b.userId, second.id);
    expect(await svc().listOf(a.userId)).toEqual([]);
    expect((await svc().listOf(b.userId)).map((row) => row.otherId)).toEqual([a.userId]);
  });
});

describe('приглашение, публичность при чтении, «вместе ехали» (K3, K6, K9)', () => {
  it('invite — в обе стороны, повтор не дублирует; removedAt не трогается', async () => {
    const inviter = await publicRider(h, 'inviter@example.by', 'Иван П.');
    const invitee = await publicRider(h, 'invitee@example.by', 'Дима Н.');
    await svc().linkInvite(inviter.userId, invitee.userId);
    await svc().linkInvite(inviter.userId, invitee.userId);
    expect(await svc().listOf(inviter.userId)).toMatchObject([
      { otherId: invitee.userId, sources: ['invite'] },
    ]);
    expect(await svc().listOf(invitee.userId)).toMatchObject([
      { otherId: inviter.userId, sources: ['invite'] },
    ]);
    expect(
      await socialDb(h).events.countDocuments({
        type: 'connection-created',
        props: { source: 'invite' },
      }),
    ).toBe(2);

    await svc().remove(invitee.userId, inviter.userId);
    await svc().linkInvite(inviter.userId, invitee.userId);
    expect(await svc().listOf(invitee.userId)).toEqual([]);
  });

  it('непубличный другой хранится, но скрыт в listOf; стал публичным — виден с карточкой', async () => {
    const owner = await publicRider(h, 'owner@example.by');
    const quiet = await rider(h, 'quiet@example.by');
    await svc().linkInvite(owner.userId, quiet.userId);
    expect(await socialDb(h).connections.countDocuments({ ownerId: owner.userId })).toBe(1);
    expect(await svc().listOf(owner.userId)).toEqual([]);

    await patchProfile(h, quiet, { publicName: 'Тихий Р.', showNameInResults: true });
    expect(await svc().listOf(owner.userId)).toMatchObject([
      { otherId: quiet.userId, card: { name: 'Тихий Р.' } },
    ]);
  });

  it('togetherOf — N общих райдов с явкой и последний; без связи — 0 и null', async () => {
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    expect(await svc().togetherOf(a.userId, b.userId)).toEqual({ rideCount: 0, lastRideAt: null });
    const ride = await pastRide(h, a, [b]);
    await attendance().markManual(a.userId, ride.id);
    await attendance().markManual(b.userId, ride.id);
    expect(await svc().togetherOf(b.userId, a.userId)).toEqual({
      rideCount: 1,
      lastRideAt: ride.startsAt,
    });
  });
});

/**
 * Дубль пары в транзакции (RC-P3-2): параллельные upsert одной пары приходят как `112 WriteConflict` (не `E11000`) и
 * повторяются `withTransaction` — одно поведение для пересчёта явки и `addManual`, повтора по `isDuplicateKey` нет.
 */
describe('дубль пары в транзакции (RC-P3-2)', () => {
  const connectionEvents = (source: string) =>
    socialDb(h).events.countDocuments({ type: 'connection-created', props: { source } });

  it('пересчёт явки стоит после чтения пар, addManual(A, B) коммитит пару — явка повторяется и сливает поля', async () => {
    const a = await publicRider(h, 'a@example.by', 'Анна К.');
    const b = await publicRider(h, 'b@example.by', 'Борис Л.');
    const ride = await pastRide(h, a, [b]);
    await attendance().markManual(a.userId, ride.id);
    const repository = h.worker.get(ConnectionsRepository);
    const original = repository.applyRideDiff.bind(repository);
    const hold = gate();
    let held = false;
    const diffs = vi.spyOn(repository, 'applyRideDiff').mockImplementation(async (...args) => {
      if (!held) {
        held = true;
        await hold.wait();
      }
      return original(...args);
    });

    const markB = attendance().markManual(b.userId, ride.id);
    await hold.reached;
    expect(await svc().addManual(a.userId, b.userId)).toBe(true);
    hold.open();
    expect(await markB).toBe(true);

    expect(diffs.mock.calls.length).toBeGreaterThanOrEqual(2);
    const ab = await socialDb(h)
      .connections.find({ ownerId: a.userId, otherId: b.userId })
      .toArray();
    expect(ab).toHaveLength(1);
    expect(ab[0]).toMatchObject({
      manualAt: expect.any(Date),
      rideCount: 1,
      rides: [{ rideId: ride.id, at: ride.startsAt }],
    });
    expect(
      await socialDb(h).connections.findOne({ ownerId: b.userId, otherId: a.userId }),
    ).toMatchObject({ rideCount: 1 });
    expect(await connectionEvents('manual')).toBe(1);
    expect(await connectionEvents('ride')).toBe(1);
  });

  it('два addManual одной пары: второй упирается в незакоммиченную запись первого и повторяется', async () => {
    const a = await rider(h, 'a@example.by');
    const b = await publicRider(h, 'b@example.by', 'Борис Л.');
    const repository = h.worker.get(ConnectionsRepository);
    const original = repository.upsertManual.bind(repository);
    const hold = gate();
    let held = false;
    const writes = vi.spyOn(repository, 'upsertManual').mockImplementation(async (...args) => {
      const created = await original(...args);
      if (!held) {
        held = true;
        await hold.wait();
      }
      return created;
    });

    const first = svc().addManual(a.userId, b.userId);
    await hold.reached;
    const second = svc().addManual(a.userId, b.userId);
    await untilBlocked(second, () => retried({ mock: { calls: writes.mock.calls.slice(1) } })());
    hold.open();
    expect(await Promise.all([first, second])).toEqual([true, false]);

    expect(
      await socialDb(h).connections.countDocuments({ ownerId: a.userId, otherId: b.userId }),
    ).toBe(1);
    expect(await connectionEvents('manual')).toBe(1);
  });
});
