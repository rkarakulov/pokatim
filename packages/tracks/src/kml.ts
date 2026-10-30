import { XMLParser } from 'fast-xml-parser';

import { TrackParseError, type ParsedPoint } from './track.ts';
import {
  assertElementCount,
  assertNoForbiddenMarkup,
  countTags,
  parseValidXml,
  ROUTE_XML_MAX_ELEMENTS,
} from './xml.ts';

/**
 * Дерево с сохранением порядка (`preserveOrder`): линии склеиваются в порядке документа, даже если `LineString`
 * и `gx:Track` — соседи разного имени. `removeNSPrefix`: `gx:Track` → `Track`, `gx:coord` → `coord`.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
  parseTagValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  preserveOrder: true,
});

type OrderedNode = Record<string, unknown>;

/** Внутри не ищем линий: метки, полигоны (их `LinearRing` — не маршрут), данные и стили. */
const SKIPPED = new Set(['Point', 'Polygon', 'LinearRing', 'ExtendedData', 'Style', 'StyleMap']);

export interface ParseKmlOptions {
  /** Предел точек: `gx:coord` — подсчётом до разбора, кортежи `coordinates` — обрывом при разборе. */
  maxPoints: number;
}

/**
 * Разбор KML маршрута (routes-02): точки из `LineString/coordinates` (`lon,lat[,alt]`, в т. ч. в `MultiGeometry`)
 * и `gx:Track/gx:coord` (`lon lat [alt]`, в т. ч. в `gx:MultiTrack`), все линии — в порядке документа (как
 * `trk`/`trkseg` в GPX). `Point`, `Polygon`, `when`, `ExtendedData` игнорируются. Высоты, равные 0 у всех точек
 * (My Maps пишет `,0`), — «высот нет». Защиты XML — как у GPX (`xml.ts`). Нет линий — `points: []`.
 */
export function parseKml(text: string, options: ParseKmlOptions): { points: ParsedPoint[] } {
  assertNoForbiddenMarkup(text);
  // KML — только маршруты: предел элементов маршрута (в т. ч. KML из KMZ до 16 МиБ)
  assertElementCount(text, ROUTE_XML_MAX_ELEMENTS);
  if (countTags(text, 'coord') > options.maxPoints) throw new TrackParseError('too_many_points');
  const document = parseValidXml(text, parser);
  const roots = asList(document);
  const kml = roots.find((node) => 'kml' in node);
  if (kml === undefined) throw new TrackParseError('unreadable');

  const points: ParsedPoint[] = [];
  const push = (point: ParsedPoint) => {
    if (points.length >= options.maxPoints) throw new TrackParseError('too_many_points');
    points.push(point);
  };
  // обход без рекурсии (глубина вложенности — из файла); стек в обратном порядке — порядок документа
  const stack: OrderedNode[] = [kml];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const name = tagName(node);
    if (name === undefined || SKIPPED.has(name)) continue;
    const children = asList(node[name]);
    if (name === 'LineString') {
      for (const child of children) {
        if (tagName(child) !== 'coordinates') continue;
        for (const tuple of textOf(child).split(/\s+/)) {
          const point = pointOf(tuple.split(','));
          if (point !== null) push(point);
        }
      }
      continue;
    }
    if (name === 'Track') {
      for (const child of children) {
        if (tagName(child) !== 'coord') continue;
        const point = pointOf(textOf(child).trim().split(/\s+/));
        if (point !== null) push(point);
      }
      continue;
    }
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
  }

  if (points.every((point) => point.ele === undefined || point.ele === 0)) {
    for (const point of points) delete point.ele;
  }
  return { points };
}

function pointOf(parts: readonly string[]): ParsedPoint | null {
  if (parts.length < 2 || parts[0] === '' || parts[1] === '') return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const point: ParsedPoint = { lat, lon };
  if (parts.length > 2 && parts[2] !== '') {
    const ele = Number(parts[2]);
    if (Number.isFinite(ele)) point.ele = ele;
  }
  return point;
}

/** Имя элемента узла `preserveOrder` (`{ name: [...], ':@'?: … }`); текст и атрибуты — `undefined`. */
function tagName(node: OrderedNode): string | undefined {
  return Object.keys(node).find((key) => key !== ':@' && key !== '#text');
}

function asList(value: unknown): OrderedNode[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is OrderedNode =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : [];
}

function textOf(node: OrderedNode): string {
  const name = tagName(node);
  if (name === undefined) return '';
  return asList(node[name])
    .map((child) => {
      const text = child['#text'];
      return typeof text === 'string' || typeof text === 'number' ? String(text) : '';
    })
    .join('');
}
