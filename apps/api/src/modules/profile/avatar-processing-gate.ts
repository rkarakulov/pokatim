import { Injectable } from '@nestjs/common';

import { PROFILE_POLICY } from './profile.policy';

/** Занятое место обработки; `release` идемпотентен. */
export interface ProcessingPermit {
  release(): void;
}

export interface ProcessingGateLimits {
  /** одновременных обработок sharp в процессе API */
  concurrency: number;
  /** сколько ждать свободного места, мс; дольше — отказ (`429` у вызывающего) */
  waitMs: number;
}

/**
 * Семафор обработки аватара (ревью PR A, MEDIUM-B): чтение тела держит только слот приёма (`UploadSlots`), а память
 * libvips — это место. Свободно — сразу; занято — ожидание в очереди до `waitMs`, затем `null`. Память процесса, не
 * Redis.
 */
export class AvatarProcessingGate {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limits: ProcessingGateLimits) {}

  acquire(): Promise<ProcessingPermit | null> {
    if (this.active < this.limits.concurrency) return Promise.resolve(this.grant());
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(this.grant());
      };
      const timer = setTimeout(() => {
        const at = this.queue.indexOf(wake);
        if (at >= 0) this.queue.splice(at, 1);
        resolve(null);
      }, this.limits.waitMs);
      this.queue.push(wake);
    });
  }

  private grant(): ProcessingPermit {
    this.active += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        const next = this.queue.shift();
        if (next) next();
      },
    };
  }
}

/** Экземпляр процесса API (провайдер `ProfileModule`): лимиты — `PROFILE_POLICY.avatarProcessing`. */
@Injectable()
export class AvatarProcessing extends AvatarProcessingGate {
  constructor() {
    super(PROFILE_POLICY.avatarProcessing);
  }
}
