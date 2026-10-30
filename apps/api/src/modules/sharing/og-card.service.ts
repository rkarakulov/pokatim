import { Inject, Injectable, Logger } from '@nestjs/common';
import { OG_BRAND, type OgCardKind, type OgCardMeta } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import {
  type OgCardKindOrBrand,
  OgCardInputs,
  ogLogId,
  type ResolvedOgCard,
} from './og-card.inputs';
import { OgCardCache } from './og-card.cache';
import { OgCardQueue } from './og-card.queue';
import { OG_CARD_POLICY, ogPrerenderable } from './sharing.policy';

/** Итог выдачи картинки: PNG текущей версии, редирект на текущую версию или бренд-заглушка (PNG или нет). */
export type OgImage =
  | { type: 'png'; png: Buffer }
  | { type: 'redirect'; version: string }
  | { type: 'fallback'; png: Buffer | null };

const notFound = () => domainError('NOT_FOUND', 404);

/**
 * OG-картинки (og-images, ADR-0018), HTTP: версия для SSR и выдача PNG. Каждый запрос заново читает публичные факты
 * (порты владельцев) и считает текущую версию — непубличный объект `404`, старая версия — редирект. Рендера здесь нет:
 * нет PNG — бренд-заглушка и постановка рендера своего хэша (NX), рендерит только worker.
 */
@Injectable()
export class OgCardService {
  private readonly logger = new Logger(OgCardService.name);

  constructor(
    private readonly inputs: OgCardInputs,
    private readonly cache: OgCardCache,
    private readonly queue: OgCardQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async meta(kind: OgCardKind, id: string): Promise<OgCardMeta> {
    const resolved = await this.inputs.resolve(kind, id);
    if (!resolved) throw notFound();
    return { version: resolved.version };
  }

  brandMeta(): OgCardMeta {
    return { version: this.inputs.resolveBrand().version };
  }

  async image(kind: OgCardKind, id: string, version: string): Promise<OgImage> {
    const resolved = await this.inputs.resolve(kind, id);
    if (!resolved) throw notFound();
    return this.serve(resolved, kind, id, version);
  }

  brandImage(version: string): Promise<OgImage> {
    return this.serve(this.inputs.resolveBrand(), OG_BRAND.kind, OG_BRAND.id, version);
  }

  private async serve(
    resolved: ResolvedOgCard,
    kind: OgCardKindOrBrand,
    id: string,
    version: string,
  ): Promise<OgImage> {
    if (resolved.version !== version) return { type: 'redirect', version: resolved.version };
    // продление — тем же TTL, что дал бы worker: вне окна пререндера выдача не делает PNG недельным
    const ttl = ogPrerenderable(resolved.input, this.clock.now())
      ? OG_CARD_POLICY.pngTtlSec
      : OG_CARD_POLICY.pngShortTtlSec;
    const png = await this.cache.png({ kind, id, hash: resolved.hash }, ttl);
    if (png) return { type: 'png', png };
    await this.enqueue(kind, id, resolved.hash);
    if (kind === OG_BRAND.kind) return { type: 'fallback', png: null };
    const brand = this.inputs.resolveBrand();
    const brandPng = await this.cache.png({ ...OG_BRAND, hash: brand.hash });
    if (!brandPng) await this.enqueue(OG_BRAND.kind, OG_BRAND.id, brand.hash);
    return { type: 'fallback', png: brandPng };
  }

  /** Самолечение: сбой очереди не ломает выдачу заглушки (следующий запрос поставит снова); лог без `publicId`. */
  private async enqueue(kind: OgCardKindOrBrand, id: string, hash: string): Promise<void> {
    try {
      await this.queue.enqueue({ kind, id, hash });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`og ${kind} ${ogLogId(kind, id, hash)}: enqueue failed (${reason})`);
    }
  }
}
