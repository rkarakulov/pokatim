import { describe, expect, it } from 'vitest';

import { ProfileView } from './profile.schema.ts';

describe('ProfileView', () => {
  it('известные коды проходят в исходном порядке', () => {
    expect(ProfileView.parse({ rideReasons: ['calendar', 'races'] })).toEqual({
      rideReasons: ['calendar', 'races'],
    });
  });

  it('пустой массив — пустой ответ', () => {
    expect(ProfileView.parse({ rideReasons: [] })).toEqual({ rideReasons: [] });
  });

  it('неизвестный код новой версии отбрасывается без ошибки разбора (R5)', () => {
    expect(ProfileView.parse({ rideReasons: ['races', 'gravel_camps', 'routes'] })).toEqual({
      rideReasons: ['races', 'routes'],
    });
  });

  it('не-массив, не-строки и отсутствие поля — ошибка', () => {
    expect(ProfileView.safeParse({ rideReasons: 'races' }).success).toBe(false);
    expect(ProfileView.safeParse({ rideReasons: [1] }).success).toBe(false);
    expect(ProfileView.safeParse({}).success).toBe(false);
  });
});
