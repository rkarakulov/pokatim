import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { describe, expect, it, vi } from 'vitest';

import { EVENT_MAX_AGE_MS, eventTimeOf, isEventStale } from './event-time';

const HOUR = 3_600_000;

describe('eventTimeOf (первые 48 бит uuidv7)', () => {
  it('время id, собранного uuidv7 в известный момент', () => {
    vi.useFakeTimers({ now: new Date('2026-10-22T09:15:30.123Z'), toFake: ['Date'] });
    try {
      expect(eventTimeOf(uuidv7())).toEqual(new Date('2026-10-22T09:15:30.123Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('фиксированный id: 0x01890a5dac96 мс', () => {
    expect(eventTimeOf('01890a5d-ac96-774b-bcce-b302099a8057')?.getTime()).toBe(0x01890a5dac96);
  });

  it.each([
    ['не UUID', 'not-a-uuid'],
    ['UUID v4', '9b2f4c1e-3a5d-4f6e-8a7b-1c2d3e4f5a6b'],
    ['верхний регистр мусора', 'zzzzzzzz-ac96-774b-bcce-b302099a8057'],
  ])('%s — null', (_name, id) => {
    expect(eventTimeOf(id)).toBeNull();
  });
});

describe('isEventStale (72 ч, N «Старые события»)', () => {
  const at = new Date('2026-10-22T00:00:00.000Z');
  const idAt = (ms: number) => {
    vi.useFakeTimers({ now: new Date(ms), toFake: ['Date'] });
    try {
      return uuidv7();
    } finally {
      vi.useRealTimers();
    }
  };

  it('ровно 72 ч — ещё свежее, на 1 мс старше — устарело', () => {
    expect(EVENT_MAX_AGE_MS).toBe(72 * HOUR);
    expect(isEventStale(idAt(at.getTime() - 72 * HOUR), at)).toBe(false);
    expect(isEventStale(idAt(at.getTime() - 72 * HOUR - 1), at)).toBe(true);
  });

  it('событие «из будущего» (часы стенда позади) — не устарело', () => {
    expect(isEventStale(idAt(at.getTime() + HOUR), at)).toBe(false);
  });

  it('время не читается — устарело (обработать нечего)', () => {
    expect(isEventStale('not-a-uuid', at)).toBe(true);
  });
});
