import type { SocialHomeResultRow, SocialHomeRideRow } from '@pokatim/contracts';
import { formatElapsed, t } from '@pokatim/i18n';

/*
 * Тексты строк секции «Свои» на Главной (K7, social-p7) — чистые функции по полям сервера: разницу со зрителем
 * считает сервер, клиент только форматирует.
 */

/** «Катя Л. идёт» / «Катя Л. и ещё 2 идут»: остальные — показанные «свои» и `othersCount`. */
export function goingText(row: Pick<SocialHomeRideRow, 'riders' | 'othersCount'>): string {
  const [first] = row.riders;
  const others = row.riders.length - 1 + row.othersCount;
  const name = first?.name ?? '';
  return others > 0
    ? t('social.home.goingMany', { name, count: others })
    : t('social.home.goingOne', { name });
}

/** «Андрей К. · 1:59:40». */
export const resultText = (row: Pick<SocialHomeResultRow, 'rider' | 'elapsedSec'>): string =>
  t('social.home.result', { name: row.rider.name, time: formatElapsed(row.elapsedSec) });

/** Модуль разницы: до часа — «m:ss», дальше — «h:mm:ss». */
export function formatDelta(sec: number): string {
  const total = Math.abs(Math.trunc(sec));
  if (total >= 3600) return formatElapsed(total);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** «на 1:20 быстрее вас» (минус — быстрее), «одно время с вами»; зрителя нет в гонке и группе — `null`. */
export function deltaText(deltaSec: number | null): string | null {
  if (deltaSec === null) return null;
  if (deltaSec === 0) return t('social.home.same');
  const delta = formatDelta(deltaSec);
  return deltaSec < 0 ? t('social.home.faster', { delta }) : t('social.home.slower', { delta });
}
