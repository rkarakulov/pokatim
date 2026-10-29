import type { RouteRejectionReason } from '@pokatim/contracts';

import type { RoutePublicationDoc } from './routes.collection';

/**
 * Порт `routes` для модуля `notifications` (ADR-0017; через `modules/routes/index.ts`): поля уведомления о решении по
 * заявке маршрута райдера (routes-06 A6). `notifications` коллекцию маршрутов не читает; комментарий модератора,
 * город и жалобы сюда не попадают (N12).
 */
export const ROUTE_NOTICES = Symbol('ROUTE_NOTICES');

export interface RoutePublicationNotice {
  id: string;
  title: string;
  ownerUserId: string;
  /** текущее состояние заявки: решение могло смениться после события (новая подача, скрытие, отзыв) */
  status: RoutePublicationDoc['status'];
  decidedAt: Date | null;
  rejectionReason: RouteRejectionReason | null;
}

export interface RouteNotices {
  /** Заявка маршрута райдера; маршрута нет, он не райдера или не подавался — `null`. */
  publication(routeId: string): Promise<RoutePublicationNotice | null>;
}
