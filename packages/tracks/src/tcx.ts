import { XMLParser } from 'fast-xml-parser';

import { TrackParseError, type ParsedPoint } from './track.ts';
import {
  assertElementCount,
  assertNoForbiddenMarkup,
  countTags,
  parseValidXml,
  ROUTE_XML_MAX_ELEMENTS,
} from './xml.ts';

/** Повторяемые элементы — всегда массивы: порядок `Track` внутри `Lap`/`Course` — порядок массива. */
const ALWAYS_ARRAY = new Set(['Activity', 'Lap', 'Course', 'Track', 'Trackpoint']);

const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
  parseTagValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (tagName) => ALWAYS_ARRAY.has(tagName),
});

type XmlNode = Record<string, unknown>;

export interface ParseTcxOptions {
  /** Предел точек: `Trackpoint` — подсчётом до разбора. */
  maxPoints: number;
}

/**
 * Разбор TCX маршрута (Garmin Training Center Database v2, routes-formats): точки
 * `Trackpoint/Position/{LatitudeDegrees, LongitudeDegrees}` (+ `AltitudeMeters` → высота) из
 * `Activities/Activity/Lap/Track` и `Courses/Course/Track` — все `Track` в порядке схемы и документа (как
 * `trk`/`trkseg` GPX). `Trackpoint` без `Position` (пауза, indoor) пропускается. `Time`, пульс, мощность,
 * `CoursePoint`, `Extensions`, `Folders` игнорируются. Защиты XML — общие (`xml.ts`). Нет точек — `points: []`.
 * TCX заездов не поддерживается (ADR-0011) — только маршрут.
 */
export function parseTcx(text: string, options: ParseTcxOptions): { points: ParsedPoint[] } {
  assertNoForbiddenMarkup(text);
  // TCX — только маршруты: предел элементов маршрута
  assertElementCount(text, ROUTE_XML_MAX_ELEMENTS);
  if (countTags(text, 'Trackpoint') > options.maxPoints)
    throw new TrackParseError('too_many_points');
  const document = parseValidXml(text, parser);
  const root = isNode(document) ? document['TrainingCenterDatabase'] : undefined;
  // `<TrainingCenterDatabase/>` разбирается в пустую строку — документ без данных
  if (root === '') return { points: [] };
  if (!isNode(root)) throw new TrackParseError('unreadable');

  // схема: Activities раньше Courses
  const tracks = [
    ...nodes(child(root, 'Activities'), 'Activity').flatMap((activity) =>
      nodes(activity, 'Lap').flatMap((lap) => nodes(lap, 'Track')),
    ),
    ...nodes(child(root, 'Courses'), 'Course').flatMap((course) => nodes(course, 'Track')),
  ];
  const points: ParsedPoint[] = [];
  for (const track of tracks) {
    for (const trackpoint of nodes(track, 'Trackpoint')) {
      const point = pointOf(trackpoint);
      if (point === null) continue;
      if (points.length >= options.maxPoints) throw new TrackParseError('too_many_points');
      points.push(point);
    }
  }
  return { points };
}

function pointOf(trackpoint: XmlNode): ParsedPoint | null {
  const position = child(trackpoint, 'Position');
  if (position === undefined) return null;
  const lat = toNumber(position['LatitudeDegrees']);
  const lon = toNumber(position['LongitudeDegrees']);
  if (lat === undefined || lon === undefined) return null;
  const point: ParsedPoint = { lat, lon };
  const ele = toNumber(trackpoint['AltitudeMeters']);
  if (ele !== undefined) point.ele = ele;
  return point;
}

function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  const value = node?.[name];
  return isNode(value) ? value : undefined;
}

function nodes(node: XmlNode | undefined, name: string): XmlNode[] {
  const value = node?.[name];
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

function toNumber(value: unknown): number | undefined {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (raw === '') return undefined;
  const number = Number(raw);
  return Number.isFinite(number) ? number : undefined;
}
