import type { CatalogRouteElevation } from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';
import { elevationAt, gainTo, gradeAt, stepDistance } from '@pokatim/tracks';

/**
 * Подписи скраббинга профиля (routes-04, S3, RC-10): чистая логика — `@pokatim/tracks` (общая с панелью, §14),
 * здесь — только перевод доли в метры и i18n. Позиция — доля 0…1: метры маршрута — `f × distanceM` (подпись км),
 * метры профиля — `f × длина профиля` (высота, уклон, набор): расхождение длин компенсирует доля (S6).
 */

export interface ScrubReadout {
  /** «12,4 км» */
  distance: string;
  /** «231 м» */
  elevation: string;
  /** «↗ 4 %», «↘ 3 %», «→ 0 %» */
  grade: string;
  /** «набор 180 м» — от старта, масштаб к набору сервера (RC-9) */
  gain: string;
  /** значение для скринридера без стрелок: «12,4 км, высота 231 м, уклон −3 %» */
  valueText: string;
}

const MINUS = '−';

export function scrubReadout(
  elevation: CatalogRouteElevation,
  distanceM: number,
  gainM: number | null,
  fraction: number,
): ScrubReadout {
  const profileD = fraction * (elevation.profile.at(-1)?.[0] ?? 0);
  const km = i18n.formatNumber(Math.round((fraction * distanceM) / 100) / 10, {
    maximumFractionDigits: 1,
  });
  const m = i18n.formatNumber(Math.round(elevationAt(elevation.profile, profileD)));
  const grade = gradeAt(elevation.profile, profileD);
  const magnitude = i18n.formatNumber(Math.abs(grade));
  return {
    distance: t('routes.detail.scrub.distance', { km }),
    elevation: t('routes.detail.scrub.elevation', { m }),
    grade:
      grade > 0
        ? t('routes.detail.scrub.gradeUp', { grade: magnitude })
        : grade < 0
          ? t('routes.detail.scrub.gradeDown', { grade: magnitude })
          : t('routes.detail.scrub.gradeFlat'),
    gain: t('routes.detail.scrub.gain', {
      gain: i18n.formatNumber(gainTo(elevation.profile, profileD, gainM)),
    }),
    valueText: t('routes.detail.scrub.value', {
      km,
      m,
      grade: grade < 0 ? `${MINUS}${magnitude}` : magnitude,
    }),
  };
}

/** Шаг adjustable / стрелок по доле: ±1 км маршрута (`stepDistance`), границы 0 и 1; длина 0 — 0. */
export function scrubStep(fraction: number, distanceM: number, direction: 1 | -1): number {
  if (distanceM <= 0) return 0;
  return stepDistance(fraction * distanceM, distanceM, direction) / distanceM;
}
