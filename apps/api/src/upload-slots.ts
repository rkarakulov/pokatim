/** Занятый слот приёма; `release` идемпотентен (повтор — без эффекта). */
export interface UploadSlot {
  release(): void;
}

export interface UploadSlotLimits {
  /** Одновременных приёмов в процессе API. */
  maxTotal: number;
  /** Одновременных приёмов одного пользователя. */
  maxPerUser: number;
}

/**
 * Слоты приёма тела загрузки в процессе API (память, не Redis): предел процесса и предел на пользователя — один
 * аккаунт медленной отправкой не занимает все слоты. Нет места — `null` (сервис отвечает `429` до чтения тела).
 * Общий для загрузок заездов и «моих маршрутов».
 */
export class UploadSlots {
  private total = 0;
  private readonly byUser = new Map<string, number>();

  constructor(private readonly limits: UploadSlotLimits) {}

  tryAcquire(userId: string): UploadSlot | null {
    const own = this.byUser.get(userId) ?? 0;
    if (this.total >= this.limits.maxTotal || own >= this.limits.maxPerUser) return null;
    this.total += 1;
    this.byUser.set(userId, own + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.total -= 1;
        const left = (this.byUser.get(userId) ?? 1) - 1;
        if (left > 0) this.byUser.set(userId, left);
        else this.byUser.delete(userId);
      },
    };
  }
}
