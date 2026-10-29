import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuditAction,
  EventMaterialAdmin,
  EventMaterialInput,
  EventMaterialsAdmin,
  EventMaterialUploadQuery,
  MaterialContentIssue,
  ReorderEventMaterialsRequest,
  TicketEventKind,
  TicketingInvalidStateDetails,
  UpdateEventMaterialRequest,
} from '@pokatim/contracts';
import { materialContentIssues } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { Binary } from 'mongodb';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { randomToken } from '../identity';
import { PanelAudit, type PanelPrincipal } from '../panel';
import type { EventMaterialDoc } from './materials.collection';
import { isPdf, MATERIALS_POLICY, safeFileName } from './materials.policy';
import { type MaterialChanges, MaterialsRepository } from './materials.repository';
import { materialAdminView } from './materials-view';
import { type PanelEvent, PanelEvents } from './panel-events';

const limitReached = (reason: 'materials_limit' | 'files_limit') => {
  const details: TicketingInvalidStateDetails = { reason };
  return domainError('TICKETING_INVALID_STATE', 409, details);
};

const fieldsError = (fields: MaterialContentIssue[]) =>
  domainError('VALIDATION_FAILED', 400, { fields });

const EDITABLE = ['type', 'title', 'description', 'url'] as const;

/**
 * Материалы события в панели (event-tickets PR C). Доступ — `PanelEvents.resolve(…, 'manage')` (та же проверка, что у
 * настроек билетов: нет права — 403, чужое — 404); каждый фильтр — с `kind, eventId`. Мутации — транзакция: замок
 * события (`lockEvent`, добавление/перестановка/удаление) → лимиты (20 материалов, 10 PDF) → запись → журнал.
 * Правила содержимого (RC-C5) — `materialContentIssues` контракта по итоговому документу. PDF — только по сигнатуре, создаётся вместе с материалом (RC-C6).
 */
@Injectable()
export class MaterialsAdminService {
  private readonly logger = new Logger(MaterialsAdminService.name);

  constructor(
    private readonly repository: MaterialsRepository,
    private readonly panelEvents: PanelEvents,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
  ): Promise<EventMaterialsAdmin> {
    await this.panelEvents.resolve(principal, kind, eventId, 'manage');
    return this.listView(kind, eventId);
  }

  async create(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    input: EventMaterialInput,
  ): Promise<EventMaterialAdmin> {
    const event = await this.panelEvents.resolve(principal, kind, eventId, 'manage');
    const doc = await this.insert(principal, event, async (tx, order, now) => {
      const material = this.newDoc(principal, event, order, now, { ...input, file: null });
      await this.repository.insert(tx, material);
      return material;
    });
    return materialAdminView(doc);
  }

  /**
   * Загрузка PDF: доступ → лимит загрузок сотрудника → счётчики → тело (`read`, обрыв на 10 МиБ) → сигнатура →
   * транзакция (повтор счётчиков, файл, материал, журнал). Всё до тела — без чтения байтов.
   */
  async upload(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    query: EventMaterialUploadQuery,
    read: () => Promise<Uint8Array>,
  ): Promise<EventMaterialAdmin> {
    const event = await this.panelEvents.resolve(principal, kind, eventId, 'manage');
    await consumeUserLimit(
      this.rateLimiter,
      `tickets-material-upload:${principal.userId}`,
      MATERIALS_POLICY.uploadLimit,
      this.clock.now(),
    );
    this.checkLimits(await this.repository.listOf(kind, eventId), true);
    const bytes = await read();
    if (!isPdf(bytes)) {
      this.logger.warn(
        `tickets.material_rejected event=${kind}:${eventId} code=MATERIAL_FILE_UNSUPPORTED`,
      );
      throw domainError('MATERIAL_FILE_UNSUPPORTED', 415);
    }
    const fileName = safeFileName(query.fileName);
    const doc = await this.insert(
      principal,
      event,
      async (tx, order, now) => {
        const fileId = randomToken();
        const material = this.newDoc(principal, event, order, now, {
          type: query.type,
          title: query.title,
          description: query.description ?? null,
          url: null,
          file: { id: fileId, name: fileName, size: bytes.byteLength },
        });
        await this.repository.insertFile(tx, {
          _id: fileId,
          kind,
          eventId,
          materialId: material._id,
          bytes: new Binary(bytes),
          contentType: 'application/pdf',
          fileName,
          size: bytes.byteLength,
          createdAt: now,
          createdBy: principal.userId,
        });
        await this.repository.insert(tx, material);
        return material;
      },
      true,
    );
    this.logger.log(`tickets.material_uploaded event=${kind}:${eventId} size=${bytes.byteLength}`);
    return materialAdminView(doc);
  }

  async update(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    id: string,
    body: UpdateEventMaterialRequest,
  ): Promise<EventMaterialAdmin> {
    const event = await this.panelEvents.resolve(principal, kind, eventId, 'manage');
    const doc = await this.transactions.run(async (tx) => {
      const current = await this.repository.find(kind, eventId, id, tx);
      if (!current) throw domainError('NOT_FOUND', 404);
      if (current.version !== body.version) throw domainError('CONFLICT', 409);
      const next = {
        type: body.type ?? current.type,
        title: body.title ?? current.title,
        description: body.description === undefined ? current.description : body.description,
        url: body.url === undefined ? current.url : body.url,
      };
      const issues = materialContentIssues({ ...next, hasFile: current.file !== null });
      if (issues.length > 0) throw fieldsError(issues);
      const changed = EDITABLE.filter((field) => next[field] !== current[field]);
      if (changed.length === 0) return current;
      const changes: MaterialChanges = Object.fromEntries(
        changed.map((field) => [field, next[field]]),
      );
      const updated = await this.repository.update(tx, kind, eventId, id, body.version, {
        ...changes,
        updatedAt: this.clock.now(),
        updatedBy: principal.userId,
      });
      if (!updated) throw domainError('CONFLICT', 409);
      await this.journal(tx, principal, event, 'tickets.material_updated', {
        changedFields: [...changed],
      });
      return updated;
    });
    return materialAdminView(doc);
  }

  async remove(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    id: string,
  ): Promise<void> {
    const event = await this.panelEvents.resolve(principal, kind, eventId, 'manage');
    await this.transactions.run(async (tx) => {
      await this.repository.lockEvent(tx, kind, eventId);
      const removed = await this.repository.delete(tx, kind, eventId, id);
      if (!removed) throw domainError('NOT_FOUND', 404);
      await this.journal(tx, principal, event, 'tickets.material_removed');
    });
  }

  async reorder(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    body: ReorderEventMaterialsRequest,
  ): Promise<EventMaterialsAdmin> {
    const event = await this.panelEvents.resolve(principal, kind, eventId, 'manage');
    await this.transactions.run(async (tx) => {
      await this.repository.lockEvent(tx, kind, eventId);
      const current = await this.repository.listOf(kind, eventId, tx);
      const known = new Set(current.map((doc) => doc._id));
      // набор id — ровно текущий (кто-то добавил или удалил — перечитать)
      if (known.size !== body.ids.length || !body.ids.every((id) => known.has(id))) {
        throw domainError('CONFLICT', 409);
      }
      if (current.every((doc, index) => doc._id === body.ids[index])) return;
      await this.repository.reorder(tx, kind, eventId, body.ids);
      await this.journal(tx, principal, event, 'tickets.materials_reordered');
    });
    return this.listView(kind, eventId);
  }

  private async listView(kind: TicketEventKind, eventId: string): Promise<EventMaterialsAdmin> {
    const docs = await this.repository.listOf(kind, eventId);
    const files = docs.filter((doc) => doc.file !== null).length;
    return {
      items: docs.map(materialAdminView),
      itemsLeft: Math.max(0, MATERIALS_POLICY.itemsMax - docs.length),
      filesLeft: Math.max(0, MATERIALS_POLICY.filesMax - files),
    };
  }

  private checkLimits(docs: readonly EventMaterialDoc[], withFile: boolean): void {
    if (docs.length >= MATERIALS_POLICY.itemsMax) throw limitReached('materials_limit');
    if (withFile && docs.filter((doc) => doc.file !== null).length >= MATERIALS_POLICY.filesMax) {
      throw limitReached('files_limit');
    }
  }

  /**
   * Добавление в транзакции: замок события → лимиты → `order = max + 1` → запись → журнал. Замок сериализует
   * добавление с другими добавлениями, перестановкой и удалением того же события (конфликт записи — повтор с новым
   * списком); уникальный порядок лимиты не защищает (перестановка уплотняет позиции). Дубль ключа — `409 CONFLICT`.
   */
  private async insert(
    principal: PanelPrincipal,
    event: PanelEvent,
    write: (tx: DbSession, order: number, now: Date) => Promise<EventMaterialDoc>,
    withFile = false,
  ): Promise<EventMaterialDoc> {
    const { kind, id: eventId } = event.facts;
    try {
      return await this.transactions.run(async (tx) => {
        await this.repository.lockEvent(tx, kind, eventId);
        const current = await this.repository.listOf(kind, eventId, tx);
        this.checkLimits(current, withFile);
        const order = (current.at(-1)?.order ?? -1) + 1;
        const doc = await write(tx, order, this.clock.now());
        await this.journal(tx, principal, event, 'tickets.material_added');
        return doc;
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw domainError('CONFLICT', 409);
      throw error;
    }
  }

  private newDoc(
    principal: PanelPrincipal,
    event: PanelEvent,
    order: number,
    now: Date,
    content: Pick<EventMaterialDoc, 'type' | 'title' | 'description' | 'url' | 'file'>,
  ): EventMaterialDoc {
    return {
      _id: uuidv7(),
      kind: event.facts.kind,
      eventId: event.facts.id,
      ...content,
      order,
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: principal.userId,
    };
  }

  private async journal(
    tx: DbSession,
    principal: PanelPrincipal,
    event: PanelEvent,
    action: AuditAction,
    details?: { changedFields: string[] },
  ): Promise<void> {
    const { facts } = event;
    await this.audit.append(tx, {
      action,
      actor: { kind: 'user', userId: principal.userId },
      subject: {
        kind: facts.kind === 'race' ? 'race' : 'calendar_start',
        id: facts.id,
        label: facts.title,
      },
      ...(details ? { details } : {}),
    });
  }
}
