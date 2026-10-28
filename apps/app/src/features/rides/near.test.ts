/// <reference types="jest" />
import { distanceLabel, nearParam, roundNear } from './near';

describe('«Рядом»: округление и подпись расстояния (05c)', () => {
  it('позиция округляется до 0,01° (~1 км) — в память и в запрос уходит только она', () => {
    expect(roundNear([27.56123, 53.90491])).toEqual([27.56, 53.9]);
    expect(roundNear([27.567, 53.896])).toEqual([27.57, 53.9]);
  });

  it('параметр запроса — «<lat>,<lon>» с двумя знаками', () => {
    expect(nearParam([27.56, 53.9])).toBe('53.90,27.56');
    expect(nearParam([27.5612, 53.9049])).toBe('53.90,27.56');
  });

  it('«в N км от вас» — целые км; ближе 1 км — «меньше 1 км»; без старта или позиции — без подписи', () => {
    const me = [27.56, 53.9] as const;
    // ~12 км на север
    expect(distanceLabel(me, [27.56, 54.008])).toBe('в 12 км от вас');
    expect(distanceLabel(me, [27.561, 53.902])).toBe('меньше 1 км от вас');
    expect(distanceLabel(me, null)).toBeNull();
    expect(distanceLabel(null, [27.56, 54.008])).toBeNull();
  });
});
