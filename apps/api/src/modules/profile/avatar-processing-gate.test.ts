import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvatarProcessingGate } from './avatar-processing-gate';

afterEach(() => {
  vi.useRealTimers();
});

describe('AvatarProcessingGate — одна обработка на процесс, короткое ожидание', () => {
  it('свободно — сразу; занято — ждёт освобождения в пределах waitMs', async () => {
    const gate = new AvatarProcessingGate({ concurrency: 1, waitMs: 5000 });
    const first = await gate.acquire();
    expect(first).not.toBeNull();
    let second: { release(): void } | null | undefined;
    const waiting = gate.acquire().then((slot) => {
      second = slot;
    });
    await Promise.resolve();
    expect(second).toBeUndefined();
    first?.release();
    await waiting;
    expect(second).not.toBeNull();
    second?.release();
    expect(await gate.acquire()).not.toBeNull();
  });

  it('занято дольше waitMs — null; очередь не держит место после таймаута', async () => {
    vi.useFakeTimers();
    const gate = new AvatarProcessingGate({ concurrency: 1, waitMs: 5000 });
    const first = await gate.acquire();
    const late = gate.acquire();
    await vi.advanceTimersByTimeAsync(5001);
    expect(await late).toBeNull();
    first?.release();
    const next = await gate.acquire();
    expect(next).not.toBeNull();
  });

  it('release идемпотентен — повтор не освобождает чужое место', async () => {
    const gate = new AvatarProcessingGate({ concurrency: 1, waitMs: 0 });
    const first = await gate.acquire();
    first?.release();
    first?.release();
    const a = await gate.acquire();
    expect(a).not.toBeNull();
    expect(await gate.acquire()).toBeNull();
  });
});
