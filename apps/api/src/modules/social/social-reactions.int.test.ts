import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { pastRide, riders, socialDb, socialServices } from '../../../test/social';
import { ReactionsRepository } from './reactions.repository';

/**
 * Реакции (K5, K8, RC-1, RC-4, RC-5, AC4): «спасибо» — только между явившимися, одно на пару в райде, повтор — no-op;
 * «респект» на заданной цели — переключение, себе нельзя; параллельные нажатия — согласованное состояние.
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

const svc = () => socialServices(h).reactions;
const blocked = (reason: string) => ({ code: 'SOCIAL_ACTION_BLOCKED', details: { reason } });

describe('«Спасибо за компанию» (K5)', () => {
  it('только между явившимися; одно на пару, повтор — no-op без события; разным получателям — можно', async () => {
    const [org, b, c, d] = await riders(h, 'org', 'b', 'c', 'd');
    const ride = await pastRide(h, org, [b, c, d]);
    for (const who of [org, b, c])
      await socialServices(h).attendance.markManual(who.userId, ride.id);

    expect(await svc().thank(org.userId, ride.id, b.userId)).toBe(true);
    expect(await svc().thank(org.userId, ride.id, b.userId)).toBe(false);
    expect(await svc().thank(org.userId, ride.id, c.userId)).toBe(true);
    expect(await svc().thank(b.userId, ride.id, org.userId)).toBe(true);
    // d — участник «Иду» без явки: ни ему, ни от него
    await expect(svc().thank(org.userId, ride.id, d.userId)).rejects.toMatchObject(
      blocked('not_attended'),
    );
    await expect(svc().thank(d.userId, ride.id, org.userId)).rejects.toMatchObject(
      blocked('not_attended'),
    );
    await expect(svc().thank(org.userId, ride.id, org.userId)).rejects.toMatchObject(
      blocked('self'),
    );
    await expect(svc().thank(org.userId, uuidv7(), b.userId)).rejects.toMatchObject(
      blocked('not_attended'),
    );

    expect(await svc().countFor('ride_rider', ride.id, 'thanks')).toBe(3);
    expect(await socialDb(h).events.countDocuments({ type: 'thanks-sent' })).toBe(3);
  });
});

describe('«Респект» (K8, RC-5)', () => {
  const target = (recipientId: string) => ({
    targetType: 'race_entry' as const,
    targetId: uuidv7(),
    recipientId,
  });

  it('переключение: поставить, снять, поставить; себе — нельзя; счётчик по цели', async () => {
    const [a, b, owner] = await riders(h, 'a', 'b', 'owner');
    const entry = target(owner.userId);
    expect(await svc().toggleRespect(a.userId, entry)).toBe(true);
    expect(await svc().toggleRespect(b.userId, entry)).toBe(true);
    expect(await svc().countFor('race_entry', entry.targetId, 'respect')).toBe(2);
    expect(await svc().toggleRespect(a.userId, entry)).toBe(false);
    expect(await svc().countFor('race_entry', entry.targetId, 'respect')).toBe(1);
    expect(await svc().toggleRespect(a.userId, entry)).toBe(true);
    expect(await svc().countFor('race_entry', entry.targetId, 'respect')).toBe(2);
    await expect(svc().toggleRespect(owner.userId, entry)).rejects.toMatchObject(blocked('self'));
    expect(
      await socialDb(h).events.countDocuments({
        type: 'respect-sent',
        props: { targetType: 'race_entry' },
      }),
    ).toBe(3);
  });

  it('гонка двух нажатий: оба прошли «снять» до вставки — одна реакция (уникальный индекс), оба видят «поставлен»', async () => {
    const [a, owner] = await riders(h, 'a', 'owner');
    const route = { targetType: 'route' as const, targetId: uuidv7(), recipientId: owner.userId };
    const repository = h.worker.get(ReactionsRepository);
    const original = repository.delete.bind(repository);
    // оба нажатия проверяют «есть ли реакция» до того, как любое из них вставит её
    let arrived = 0;
    let release!: () => void;
    const bothChecked = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(repository, 'delete').mockImplementation(async (key) => {
      const deleted = await original(key);
      arrived += 1;
      if (arrived === 2) release();
      await bothChecked;
      return deleted;
    });
    expect(
      await Promise.all([
        svc().toggleRespect(a.userId, route),
        svc().toggleRespect(a.userId, route),
      ]),
    ).toEqual([true, true]);
    expect(await socialDb(h).reactions.countDocuments({ actorId: a.userId })).toBe(1);
    expect(await socialDb(h).events.countDocuments({ type: 'respect-sent' })).toBe(1);
  });
});

describe('«Поблагодарить всех» (P4, Q1, RC-P4-8)', () => {
  it('всем явившимся, включая непубличных, кроме себя; повтор — 0 без новых событий', async () => {
    const [org, b, c, d] = await riders(h, 'org', 'b', 'c', 'd');
    const ride = await pastRide(h, org, [b, c, d]);
    for (const who of [org, b, c])
      await socialServices(h).attendance.markManual(who.userId, ride.id);
    // уже поблагодарённый не получает второе
    expect(await svc().thank(org.userId, ride.id, b.userId)).toBe(true);

    expect(await svc().thankAll(org.userId, ride.id)).toBe(1);
    expect([...(await svc().thankedBy(org.userId, ride.id))].sort()).toEqual(
      [b.userId, c.userId].sort(),
    );
    expect(await svc().thankAll(org.userId, ride.id)).toBe(0);
    expect(await socialDb(h).events.countDocuments({ type: 'thanks-sent' })).toBe(2);
    // d без явки — не получатель; сам d без явки — 409
    await expect(svc().thankAll(d.userId, ride.id)).rejects.toMatchObject(blocked('not_attended'));
    expect(await socialDb(h).reactions.countDocuments({ recipientId: d.userId })).toBe(0);
  });

  it('единственный явившийся — 0 новых', async () => {
    const [org, b] = await riders(h, 'org', 'b');
    const ride = await pastRide(h, org, [b]);
    await socialServices(h).attendance.markManual(org.userId, ride.id);
    expect(await svc().thankAll(org.userId, ride.id)).toBe(0);
  });
});

describe('«Респект» идемпотентно (P4, RC-P4-4)', () => {
  const target = (recipientId: string) => ({
    targetType: 'route' as const,
    targetId: uuidv7(),
    recipientId,
  });

  it('поставить, повтор не переключает; снять, повтор — no-op; себе — 409; поставившие — новые сверху', async () => {
    const [a, b, owner] = await riders(h, 'a', 'b', 'owner');
    const route = target(owner.userId);
    expect(await svc().setRespect(a.userId, route, true)).toBe(true);
    expect(await svc().setRespect(a.userId, route, true)).toBe(false);
    expect(await svc().respectedBy(a.userId, route)).toBe(true);
    h.clock.advance(1000);
    expect(await svc().setRespect(b.userId, route, true)).toBe(true);
    expect(await svc().respectActors(route, 10)).toEqual([b.userId, a.userId]);
    expect(await svc().respectActors(route, 1)).toEqual([b.userId]);
    expect(await svc().setRespect(a.userId, route, false)).toBe(true);
    expect(await svc().setRespect(a.userId, route, false)).toBe(false);
    expect(await svc().respectedBy(a.userId, route)).toBe(false);
    expect(await svc().countFor('route', route.targetId, 'respect')).toBe(1);
    await expect(svc().setRespect(owner.userId, route, true)).rejects.toMatchObject(
      blocked('self'),
    );
    await expect(svc().setRespect(owner.userId, route, false)).rejects.toMatchObject(
      blocked('self'),
    );
    expect(await socialDb(h).events.countDocuments({ type: 'respect-sent' })).toBe(2);
  });

  it('параллельные PUT true — одна запись и одно событие', async () => {
    const [a, owner] = await riders(h, 'a', 'owner');
    const route = target(owner.userId);
    const results = await Promise.all([
      svc().setRespect(a.userId, route, true),
      svc().setRespect(a.userId, route, true),
      svc().setRespect(a.userId, route, true),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await socialDb(h).reactions.countDocuments({ actorId: a.userId })).toBe(1);
    expect(await socialDb(h).events.countDocuments({ type: 'respect-sent' })).toBe(1);
  });
});
