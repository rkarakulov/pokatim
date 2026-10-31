import { Injectable } from '@nestjs/common';

import { UploadSlots } from '../../upload-slots';
import { MEDIA_POLICY } from './media.policy';

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
 * Семафор обработки изображений (ревью rider-profile PR A, MEDIUM-B): чтение тела держит только слот приёма
 * (`UploadSlots`), а память libvips — это место. Свободно — сразу; занято — ожидание в очереди до `waitMs`, затем
 * `null`. Память процесса, не Redis.
 */
export class ImageProcessingGate {
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

/**
 * Экземпляр процесса API (провайдер **только** `MediaModule`): одна обработка на все фото — аватар и фото райда
 * (ADR-0028); лимиты — `MEDIA_POLICY.processing`.
 */
@Injectable()
export class ImageProcessing extends ImageProcessingGate {
  constructor() {
    super(MEDIA_POLICY.processing);
  }
}

/** Слоты чтения тела фото процесса API — общие для аватара и фото райда (провайдер `MediaModule`, ADR-0028). */
@Injectable()
export class ImageUploadSlots extends UploadSlots {
  constructor() {
    super(MEDIA_POLICY.uploadSlots);
  }
}
