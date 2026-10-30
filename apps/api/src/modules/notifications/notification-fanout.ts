import type { NotificationKind, NotificationTarget } from '@pokatim/contracts';

import type { NoticeDraft } from './notification-intake';
import { renderNotification } from './notification-texts';
import { type FanoutJobData, fanoutJobId } from './notifications.events';

/** Черновик после отрисовки текста (снимок): общий вход записи для прямого пути intake и пачки. */
export interface RenderedDraft {
  kind: NotificationKind;
  title: string;
  body: string;
  target: NotificationTarget | null;
  /** цель получателя поверх `target` */
  targets?: ReadonlyMap<string, NotificationTarget>;
  collapse?: { key: string; seq?: number };
}

export function renderDraft(draft: NoticeDraft): RenderedDraft {
  const { title, body } = renderNotification(draft.text);
  return {
    kind: draft.text.kind,
    title,
    body,
    target: draft.target,
    ...(draft.targets === undefined ? {} : { targets: draft.targets }),
    ...(draft.collapse === undefined ? {} : { collapse: draft.collapse }),
  };
}

export interface FanoutChunk {
  jobId: string;
  data: FanoutJobData;
}

/**
 * Раскладка события на пачки получателей (`notifications.fanout`): аудитория (сумма уникальных получателей непустых
 * черновиков, до проверки живости) ≤ `chunk` — `null` (одна задача intake, как раньше). Иначе — пачки по `chunk`
 * получателей каждого непустого черновика; номер черновика — среди непустых (пачка `0-0` есть всегда), текст
 * отрисован один раз, `targets` пачки — только её получатели. Состав и границы фиксируются здесь, один раз.
 */
export function planFanout(
  eventId: string,
  type: string,
  drafts: readonly NoticeDraft[],
  chunk: number,
): FanoutChunk[] | null {
  const audience = drafts
    .map((draft) => ({ draft, recipients: [...new Set(draft.recipients)] }))
    .filter(({ recipients }) => recipients.length > 0);
  const total = audience.reduce((sum, { recipients }) => sum + recipients.length, 0);
  if (total <= chunk) return null;
  return audience.flatMap(({ draft, recipients }, d) => {
    const rendered = renderDraft(draft);
    const chunks: FanoutChunk[] = [];
    for (let start = 0, c = 0; start < recipients.length; start += chunk, c++) {
      const userIds = recipients.slice(start, start + chunk);
      const targets = rendered.targets;
      chunks.push({
        jobId: fanoutJobId(eventId, d, c),
        data: {
          eventId,
          type,
          kind: rendered.kind,
          title: rendered.title,
          body: rendered.body,
          target: rendered.target,
          ...(targets === undefined
            ? {}
            : {
                targets: Object.fromEntries(
                  userIds.flatMap((userId) => {
                    const target = targets.get(userId);
                    return target ? [[userId, target] as const] : [];
                  }),
                ),
              }),
          ...(rendered.collapse === undefined ? {} : { collapse: rendered.collapse }),
          userIds,
        },
      });
    }
    return chunks;
  });
}
