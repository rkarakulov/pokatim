import { describe, expect, it } from 'vitest';

import { UploadSlots } from './upload-slots';

describe('слоты приёма загрузок', () => {
  it('у пользователя один приём: второй — отказ, другой пользователь — слот; после release — снова слот', () => {
    const slots = new UploadSlots({ maxTotal: 4, maxPerUser: 1 });
    const first = slots.tryAcquire('a');
    expect(first).not.toBeNull();
    expect(slots.tryAcquire('a')).toBeNull();
    expect(slots.tryAcquire('b')).not.toBeNull();
    first?.release();
    expect(slots.tryAcquire('a')).not.toBeNull();
  });

  it('предел процесса: пятый одновременный разных пользователей — отказ; освобождение — место', () => {
    const slots = new UploadSlots({ maxTotal: 4, maxPerUser: 1 });
    const held = ['a', 'b', 'c', 'd'].map((user) => slots.tryAcquire(user));
    expect(held.every((slot) => slot !== null)).toBe(true);
    expect(slots.tryAcquire('e')).toBeNull();
    held[0]?.release();
    expect(slots.tryAcquire('e')).not.toBeNull();
  });

  it('release идемпотентен: повтор не освобождает чужой слот и не уводит счётчики в минус', () => {
    const slots = new UploadSlots({ maxTotal: 2, maxPerUser: 1 });
    const a = slots.tryAcquire('a');
    a?.release();
    a?.release();
    expect(slots.tryAcquire('a')).not.toBeNull();
    expect(slots.tryAcquire('b')).not.toBeNull();
    // повторный release старого слота `a` не освобождает новый слот `a` и место процесса
    a?.release();
    expect(slots.tryAcquire('a')).toBeNull();
    expect(slots.tryAcquire('c')).toBeNull();
  });

  it('отказ по пределу процесса не занимает слот пользователя', () => {
    const slots = new UploadSlots({ maxTotal: 1, maxPerUser: 1 });
    const a = slots.tryAcquire('a');
    expect(slots.tryAcquire('b')).toBeNull();
    a?.release();
    expect(slots.tryAcquire('b')).not.toBeNull();
  });
});
