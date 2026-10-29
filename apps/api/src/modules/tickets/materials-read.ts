import { Injectable } from '@nestjs/common';
import type { EventMaterial, TicketEventKind } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { MaterialsRepository } from './materials.repository';
import { materialView } from './materials-view';
import { TicketEvents } from './ticket-events';

/**
 * Чтение материалов для участников (event-tickets PR C): публичный список карточки события, `TicketView.materials`,
 * письмо «Вы зарегистрированы». Байты PDF не читаются (проекция списка — документ материала).
 */
@Injectable()
export class MaterialsRead {
  constructor(
    private readonly repository: MaterialsRepository,
    private readonly events: TicketEvents,
  ) {}

  /** Материалы события по порядку (без проверки видимости — вызывающий уже знает событие). */
  async of(kind: TicketEventKind, eventId: string): Promise<EventMaterial[]> {
    return (await this.repository.listOf(kind, eventId)).map(materialView);
  }

  /**
   * Публичный список (RC-C9): только публично видимое событие — гонка `published|cancelled` (`RACE_REGISTRY`), старт
   * календаря `published`; независимо от включённых билетов. Иначе — один 404.
   */
  async publicList(kind: TicketEventKind, eventId: string): Promise<EventMaterial[]> {
    const facts = await this.events.resolve(kind, eventId);
    if (!facts || (kind === 'calendar' && !facts.published)) throw domainError('NOT_FOUND', 404);
    return this.of(kind, eventId);
  }
}
