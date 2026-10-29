import { RegistrationUrl, type EventMaterial } from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';

import type { IconName } from '@/components/icon';
import { api } from '@/lib/api';

/**
 * Материалы события (event-tickets PR C, plan-C §7): модель строки — иконка темы, подпись и действие. Тема — только
 * подпись (RC-C5); содержимое — https-ссылка, PDF или текст. Незнакомая тема нового сервера (`unknown`) — общая иконка.
 */
const ICON: Record<EventMaterial['type'], IconName> = {
  rules: 'document',
  what_to_bring: 'bag',
  clothing: 'clothing',
  route: 'routes',
  safety: 'safety',
  gpx: 'gpx',
  parking: 'parking',
  start_procedure: 'flag',
  nutrition: 'food',
  weather: 'weather',
  pdf: 'pdf',
  link: 'link',
  text: 'text',
  unknown: 'document',
};

export const materialIcon = (type: EventMaterial['type']): IconName => ICON[type];

export type MaterialAction =
  { kind: 'link'; url: string } | { kind: 'file'; url: string } | { kind: 'text' };

/** Публичный ответ формат ссылки не гарантирует (`z.string()`) — та же проверка, что ввод панели (https, без `user@`). */
const safeUrl = (url: string | null): string | null => {
  if (url === null) return null;
  const parsed = RegistrationUrl.safeParse(url);
  return parsed.success ? parsed.data : null;
};

/**
 * Нажатие строки: ссылка — системный браузер, PDF — скачивание `GET /v1/event-files/<id>` (без входа, `attachment`),
 * иначе (текст, небезопасная ссылка) — раскрытие описания.
 */
export function materialAction(material: EventMaterial): MaterialAction {
  if (material.file) return { kind: 'file', url: api.eventFileUrl(material.file.id) };
  const url = safeUrl(material.url);
  return url ? { kind: 'link', url } : { kind: 'text' };
}

const SIZE_MB = 1024 * 1024;

/** «1,2 МБ» / «340 КБ» (не меньше 1 КБ). */
export function formatFileSize(bytes: number): string {
  if (bytes >= SIZE_MB) {
    return t('tickets.materials.sizeMb', {
      value: i18n.formatNumber(bytes / SIZE_MB, { maximumFractionDigits: 1 }),
    });
  }
  return t('tickets.materials.sizeKb', {
    value: i18n.formatNumber(Math.max(1, Math.round(bytes / 1024))),
  });
}

/** Подпись под названием: PDF — «PDF · 1,2 МБ», ссылка — домен (без `www.`), текст — нет. */
export function materialMeta(material: EventMaterial): string | null {
  if (material.file)
    return t('tickets.materials.pdf', { size: formatFileSize(material.file.size) });
  const url = safeUrl(material.url);
  if (!url) return null;
  // без `new URL(…).hostname`: в React Native `URL` неполный; адрес уже https без учётных данных (`RegistrationUrl`)
  const host = /^https:\/\/([^/?#:]+)/i.exec(url)?.[1];
  return host ? host.toLowerCase().replace(/^www\./, '') : null;
}
