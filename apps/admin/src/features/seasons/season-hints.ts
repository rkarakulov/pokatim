import type { PanelSeason } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { formatLocalDate } from '../../format';

/** «1 апреля — 31 октября 2026» для подсказок и ошибок. */
export function seasonRangeText(season: Pick<PanelSeason, 'startsOn' | 'endsOn'>): string {
  return t('admin.seasons.range', {
    from: formatLocalDate(season.startsOn),
    to: formatLocalDate(season.endsOn),
  });
}

/**
 * Подсказка UI (источник истины — сервер, `SEASON_OVERLAP`): сезон из загруженного списка, пересекающий даты, и поле,
 * которое попало внутрь (оба или охват — `startsOn`).
 */
export function overlapHint(
  seasons: readonly PanelSeason[],
  dates: { startsOn: string; endsOn: string },
  exceptId: string | undefined,
): { season: PanelSeason; path: 'startsOn' | 'endsOn' } | undefined {
  const { startsOn, endsOn } = dates;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn))
    return undefined;
  if (endsOn < startsOn) return undefined;
  const season = seasons.find(
    (other) => other.id !== exceptId && startsOn <= other.endsOn && other.startsOn <= endsOn,
  );
  if (!season) return undefined;
  const inside = (date: string) => date >= season.startsOn && date <= season.endsOn;
  return { season, path: !inside(startsOn) && inside(endsOn) ? 'endsOn' : 'startsOn' };
}

/** Текст ошибки пересечения с названием и датами сезона. */
export const overlapText = (season: PanelSeason) =>
  t('field.error.SEASON_OVERLAP_WITH', { name: season.name, range: seasonRangeText(season) });

/** Сезон, в который попадает дата Минска (конец окна гонки) — предпросмотр в форме гонки. */
export function seasonOfDate(
  seasons: readonly PanelSeason[],
  date: string,
): PanelSeason | undefined {
  return seasons.find((season) => season.startsOn <= date && date <= season.endsOn);
}
