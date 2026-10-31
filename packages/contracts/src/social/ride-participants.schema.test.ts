import { describe, expect, it } from 'vitest';

import {
  RIDE_ATTENDANCE_STATES,
  RideParticipants,
  RideRiderRow,
} from './ride-participants.schema.ts';

const PUB = 'p'.repeat(43);
const AV = 'a'.repeat(43);

describe('RideParticipants (P2): участники райда и явка зрителя', () => {
  it('справочник состояний — только добавление в конец', () => {
    expect(RIDE_ATTENDANCE_STATES).toEqual(['none', 'attended', 'declined']);
  });

  it('старый ответ без `attendance` → `null`', () => {
    expect(RideParticipants.parse({ riders: [], hiddenCount: 3 })).toEqual({
      riders: [],
      hiddenCount: 3,
      attendance: null,
    });
  });

  it('строка без `publicId` и `avatar` → `null`', () => {
    expect(RideRiderRow.parse({ name: 'Аня' })).toEqual({
      name: 'Аня',
      publicId: null,
      avatar: null,
    });
  });

  it('незнакомое состояние → `unknown`, флаги и «Ехали» по умолчанию', () => {
    const parsed = RideParticipants.parse({
      riders: [],
      hiddenCount: 0,
      attendance: { state: 'thanked' },
    });
    expect(parsed.attendance).toEqual({
      state: 'unknown',
      canMark: false,
      canDecline: false,
      attended: null,
    });
  });

  it('полный ответ с «Ехали N» разбирается', () => {
    const body = {
      riders: [{ name: 'Аня', publicId: PUB, avatar: { id: AV } }],
      hiddenCount: 1,
      attendance: {
        state: 'attended',
        canMark: false,
        canDecline: true,
        attended: { riders: [{ name: 'Аня', publicId: PUB, avatar: null }], hiddenCount: 0 },
      },
    };
    expect(RideParticipants.parse(body)).toEqual(body);
  });

  it('отрицательный `hiddenCount` — ошибка', () => {
    expect(RideParticipants.safeParse({ riders: [], hiddenCount: -1 }).success).toBe(false);
  });
});
