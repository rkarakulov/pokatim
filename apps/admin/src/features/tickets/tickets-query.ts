import { type TicketCategory, type TicketEventKind } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

/** Ключи билетов события в кэше панели (настройки, материалы, участники). */
export const ticketsKey = (kind: TicketEventKind, eventId: string) =>
  ['admin', 'tickets', kind, eventId] as const;

export const ticketingQuery = (kind: TicketEventKind, eventId: string) =>
  queryOptions({
    queryKey: [...ticketsKey(kind, eventId), 'settings'],
    queryFn: () => api.getEventTicketing(kind, eventId),
  });

export const materialsQuery = (kind: TicketEventKind, eventId: string) =>
  queryOptions({
    queryKey: [...ticketsKey(kind, eventId), 'materials'],
    queryFn: () => api.listEventMaterials(kind, eventId),
  });

const SIZE = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «1,2 МБ» / «340 КБ» из байт. */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return t('admin.tickets.size.mb', { value: SIZE.format(mb) });
  return t('admin.tickets.size.kb', { value: SIZE.format(Math.max(1, Math.round(bytes / 1024))) });
}

/** Категория участника: «Мужчины до 40 · Verified» или «42,2 км»; нет — пусто. */
export function formatCategory(category: TicketCategory): string {
  if (category === null) return '';
  if (category.kind === 'race') {
    return `${t(`results.group.${category.groupKey}`)} · ${t(`results.tier.${category.tier}`)}`;
  }
  return category.distanceKm === null
    ? ''
    : t('admin.tickets.distance', { km: SIZE.format(category.distanceKm) });
}
