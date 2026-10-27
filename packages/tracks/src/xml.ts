import { XMLValidator, type XMLParser } from 'fast-xml-parser';

import { TRACK_MAX_POINTS, TrackParseError } from './track.ts';

/**
 * Общие защиты разбора XML (GPX, KML): DTD и сущности не нужны ни одному формату; их наличие — XXE / «миллиард
 * смехов». Отказ до запуска парсера.
 */
export const FORBIDDEN_MARKUP = /<!DOCTYPE|<!ENTITY/i;

/**
 * Предел элементов документа до разбора: точка с расширениями — до ~10 элементов (открывающих тегов), запас ×2.
 * Враждебный документ с миллионами элементов отвергается подсчётом, а не разбором в дерево (память потока worker).
 */
export const XML_MAX_ELEMENTS = TRACK_MAX_POINTS * 20;

/** Число совпадений глобального регулярного выражения без сборки массива. */
export function countMatches(text: string, pattern: RegExp): number {
  let count = 0;
  pattern.lastIndex = 0;
  while (pattern.exec(text) !== null) count += 1;
  return count;
}

const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Число открывающих тегов `name` с любым префиксом пространства имён (`<trkpt`, `<g:trkpt`), без разбора XML. */
export function countTags(text: string, name: string): number {
  return countMatches(text, new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escapeName(name)}[\\s/>]`, 'g'));
}

/** Открывающие теги (без закрывающих, комментариев и инструкций) — грубая оценка размера дерева. */
export const ELEMENT_OPEN = /<[^/!?]/g;

/** Запрет DTD и сущностей — `unreadable`. */
export function assertNoForbiddenMarkup(text: string): void {
  if (FORBIDDEN_MARKUP.test(text)) throw new TrackParseError('unreadable');
}

/** Открывающих тегов больше `maxElements` — `too_many_points` (до разбора в дерево). */
export function assertElementCount(text: string, maxElements = XML_MAX_ELEMENTS): void {
  if (countMatches(text, ELEMENT_OPEN) > maxElements) throw new TrackParseError('too_many_points');
}

/**
 * Разбор после проверок размера: `XMLValidator` (парсер fast-xml-parser не проверяет корректность разметки) →
 * `parse`. Любая ошибка — `TrackParseError('unreadable')`.
 */
export function parseValidXml(text: string, parser: XMLParser): unknown {
  try {
    if (XMLValidator.validate(text) !== true) throw new TrackParseError('unreadable');
    return parser.parse(text);
  } catch (error) {
    if (error instanceof TrackParseError) throw error;
    throw new TrackParseError('unreadable');
  }
}
