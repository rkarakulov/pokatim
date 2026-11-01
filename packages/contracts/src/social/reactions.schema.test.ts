import { describe, expect, it } from 'vitest';

import { RespectState, RideThanksRequest, SetRespectRequest } from './reactions.schema.ts';

const PUB = 'p'.repeat(43);

describe('Реакции (P4, K5, K8): тела и состояние респекта', () => {
  it('RideThanksRequest — пустое тело («Поблагодарить всех») и `publicId`', () => {
    expect(RideThanksRequest.parse({})).toEqual({});
    expect(RideThanksRequest.parse({ publicId: PUB })).toEqual({ publicId: PUB });
  });

  it('RideThanksRequest — лишний ключ и неверный `publicId` — ошибка', () => {
    expect(RideThanksRequest.safeParse({ publicId: PUB, userId: 'x' }).success).toBe(false);
    expect(RideThanksRequest.safeParse({ publicId: 'short' }).success).toBe(false);
    expect(RideThanksRequest.safeParse({ publicId: null }).success).toBe(false);
  });

  it('SetRespectRequest — strict, `respected` обязателен', () => {
    expect(SetRespectRequest.parse({ respected: true })).toEqual({ respected: true });
    expect(SetRespectRequest.safeParse({}).success).toBe(false);
    expect(SetRespectRequest.safeParse({ respected: true, recipient: PUB }).success).toBe(false);
  });

  it('RespectState — по умолчанию нейтральное', () => {
    expect(RespectState.parse({})).toEqual({
      available: false,
      respected: false,
      count: 0,
      own: false,
      from: null,
    });
  });

  it('RespectState — `from` получателю разбирается; `userId` отбрасывается', () => {
    const parsed = RespectState.parse({
      available: false,
      respected: false,
      count: 3,
      own: true,
      userId: 'secret',
      from: { riders: [{ name: 'Аня', publicId: PUB, avatar: null, userId: 'u' }], hiddenCount: 2 },
    });
    expect(parsed).toEqual({
      available: false,
      respected: false,
      count: 3,
      own: true,
      from: { riders: [{ name: 'Аня', publicId: PUB, avatar: null }], hiddenCount: 2 },
    });
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });

  it('RespectState — отрицательный `count` — ошибка', () => {
    expect(RespectState.safeParse({ count: -1 }).success).toBe(false);
  });
});
