import type { CatalogRouteElevation } from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';
import { profileTickValues, scrubValues } from '@pokatim/route-view';

/**
 * Подписи страницы маршрута панели (routes-05): числа — `@pokatim/route-view` (общие с приложением), здесь — только
 * i18n. Формулировки скраббинга и времени в пути — те же, что в карточке приложения (`routes.detail.*`).
 */

const MINUS = '−';
const km = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });

export interface ScrubText {
  /** «12,4 км · 231 м · ↗ 4 % · набор 180 м» — карточка над профилем */
  readout: string;
  /** «12,4 км, высота 231 м, уклон −3 %» — `aria-valuetext` slider */
  valueText: string;
  /** км маршрута — `aria-valuenow` */
  km: number;
}

export function scrubText(
  elevation: CatalogRouteElevation,
  distanceM: number,
  gainM: number | null,
  fraction: number,
): ScrubText {
  const values = scrubValues(elevation, distanceM, gainM, fraction);
  const distance = km(values.km);
  const m = i18n.formatNumber(values.elevationM);
  const magnitude = i18n.formatNumber(Math.abs(values.grade));
  const grade =
    values.grade > 0
      ? t('routes.detail.scrub.gradeUp', { grade: magnitude })
      : values.grade < 0
        ? t('routes.detail.scrub.gradeDown', { grade: magnitude })
        : t('routes.detail.scrub.gradeFlat');
  return {
    readout: [
      t('routes.detail.scrub.distance', { km: distance }),
      t('routes.detail.scrub.elevation', { m }),
      grade,
      t('routes.detail.scrub.gain', { gain: i18n.formatNumber(values.gainM) }),
    ].join(' · '),
    valueText: t('routes.detail.scrub.value', {
      km: distance,
      m,
      grade: values.grade < 0 ? `${MINUS}${magnitude}` : magnitude,
    }),
    km: values.km,
  };
}

/** Подписи оси X профиля: «0», «20», «60 км» — единица у последней; позиция — доля оси. */
export function profileTickLabels(distanceM: number): { position: number; label: string }[] {
  const ticks = profileTickValues(distanceM);
  return ticks.map((tick, index) => {
    const value = i18n.formatNumber(tick.km, { maximumFractionDigits: 2 });
    return {
      position: tick.position,
      label: index === ticks.length - 1 ? t('routes.detail.profile.tick', { km: value }) : value,
    };
  });
}

/** Текстовая альтернатива профиля: «Профиль высоты: от 191 до 267 м, набор 620 м». */
export function profileSummary(elevation: CatalogRouteElevation, gainM: number | null): string {
  const range = { min: i18n.formatNumber(elevation.minM), max: i18n.formatNumber(elevation.maxM) };
  return gainM === null
    ? t('routes.detail.profile.summaryNoGain', range)
    : t('routes.detail.profile.summary', { ...range, gain: i18n.formatNumber(gainM) });
}

/** Время в пути: «2 ч 30 мин», «45 мин», «3 ч». */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [
    hours > 0 ? t('routes.detail.stats.hours', { hours }) : null,
    rest > 0 || hours === 0 ? t('routes.detail.stats.minutes', { minutes: rest }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

/** Высота/набор в метрах: «1 240 м». */
export const metersText = (value: number) =>
  t('admin.routes.elevation', { gain: i18n.formatNumber(value) });
