import { t } from '@pokatim/i18n';
import type { PointerEvent } from 'react';

import { formatKmFromMeters } from '../../format';

/** Единицы `viewBox` графика (не px): масштабируются по ширине блока, линии — `non-scaling-stroke`. */
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 160;
/** Поле по высоте, доля размаха: линия не касается краёв. */
const Y_PADDING = 0.08;

export type SeriesKind = 'heartRate' | 'power' | 'speed';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
export const formatValue = (value: number | null, kind: SeriesKind) =>
  value === null ? '—' : `${number.format(value)} ${t(`admin.disputes.series.unit.${kind}`)}`;

/** Ближайшая ячейка к доле ширины `ratio` (0…1) по концам ячеек `distanceM`. */
export function binAt(distanceM: readonly number[], ratio: number): number {
  const total = distanceM.at(-1) ?? 0;
  const target = Math.min(Math.max(ratio, 0), 1) * total;
  let low = 0;
  let high = distanceM.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (distanceM[mid]! < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Нижняя и верхняя граница шкалы Y — минимум и максимум значений ряда; значений нет — `null`. */
export function seriesRange(
  values: readonly (number | null)[],
): { min: number; max: number } | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : { min: Math.min(...present), max: Math.max(...present) };
}

/**
 * Путь линии ряда в координатах `viewBox`: X — дистанция конца ячейки, Y — значение (вверх больше); `null` разрывает
 * линию (нет данных датчика в ячейке). Меньше двух значений — `null`.
 */
export function seriesPath(
  distanceM: readonly number[],
  values: readonly (number | null)[],
): string | null {
  const present = values.filter((value): value is number => value !== null);
  const total = distanceM.at(-1) ?? 0;
  if (present.length < 2 || total <= 0) return null;
  let min = Math.min(...present);
  let max = Math.max(...present);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * Y_PADDING;
  const y = (value: number) =>
    Math.round((VIEW_HEIGHT - ((value - min + pad) / (max - min + 2 * pad)) * VIEW_HEIGHT) * 10) /
    10;
  let path = '';
  let open = false;
  values.forEach((value, k) => {
    if (value === null) {
      open = false;
      return;
    }
    const x = Math.round((distanceM[k]! / total) * VIEW_WIDTH * 10) / 10;
    path += `${open ? 'L' : 'M'}${x},${y(value)}`;
    open = true;
  });
  return path;
}

/**
 * График одного ряда по дистанции сегмента (разбор спора, 06b): один ряд — без легенды, название — заголовок; сводка
 * текстом, шкала Y — минимум и максимум ряда текстом (линия нормирована по ним); перекрестие и значение под курсором
 * (общее для трёх графиков — `hover` у родителя). Картинка без фокуса: клавиатурный и экранный доступ к значениям —
 * таблица в `<details>`, значение под курсором не объявляется (`aria-live` нет — поток значений при движении мыши).
 */
export function SeriesChart({
  kind,
  distanceM,
  values,
  summary,
  hover,
  onHover,
}: {
  kind: SeriesKind;
  distanceM: readonly number[];
  values: readonly (number | null)[];
  summary: string;
  hover: number | null;
  onHover: (bin: number | null) => void;
}) {
  const range = seriesRange(values);
  const name = t(`admin.disputes.series.${kind}`);
  const path = seriesPath(distanceM, values);
  const total = distanceM.at(-1) ?? 0;

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) onHover(binAt(distanceM, (event.clientX - rect.left) / rect.width));
  };
  const readout =
    hover === null
      ? summary
      : t('admin.disputes.series.point', {
          distance: formatKmFromMeters(distanceM[hover]!),
          value: formatValue(values[hover] ?? null, kind),
        });

  return (
    <figure className="series-chart">
      <figcaption className="series-chart__head">
        <span className="t-label">{name}</span>
        <span className="series-chart__readout t-meta">{readout}</span>
        {range ? (
          <span className="series-chart__range t-meta">
            {t('admin.disputes.series.range', {
              min: number.format(range.min),
              max: number.format(range.max),
              unit: t(`admin.disputes.series.unit.${kind}`),
            })}
          </span>
        ) : null}
      </figcaption>
      <svg
        className="series-chart__plot"
        role="img"
        aria-label={t('admin.disputes.series.chartLabel', { name, summary })}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        onPointerMove={move}
        onPointerLeave={() => onHover(null)}
      >
        <line
          className="series-chart__grid"
          x1={0}
          x2={VIEW_WIDTH}
          y1={VIEW_HEIGHT}
          y2={VIEW_HEIGHT}
        />
        {path ? <path className="series-chart__line" d={path} /> : null}
        {hover !== null && total > 0 ? (
          <line
            className="series-chart__crosshair"
            x1={(distanceM[hover]! / total) * VIEW_WIDTH}
            x2={(distanceM[hover]! / total) * VIEW_WIDTH}
            y1={0}
            y2={VIEW_HEIGHT}
          />
        ) : null}
      </svg>
    </figure>
  );
}
