import { Decoder, Stream, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';

import {
  TrackParseError,
  type ActivitySport,
  type ParsedPoint,
  type ParsedTrack,
} from './track.ts';

const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;
const CYCLING_SPORTS = new Set(['cycling', 'eBiking']);
const INDOOR_SUB_SPORTS = new Set(['indoorCycling', 'spin', 'virtualActivity']);

/**
 * Разбор FIT (`@garmin/fitsdk`). Проверка CRC (`checkIntegrity`), любая ошибка декодера — `unreadable`.
 * Developer-поля и неизвестные сообщения не используются (`includeUnknownData: false`), memo glob и слияние
 * HR-сообщений выключены. Сжатые метки времени (compressed timestamp header) декодер SDK 21.218 не поддерживает
 * («not currently supported») — такой файл даёт `unreadable`.
 * Несколько сессий (мультиспорт): точки всех сессий; спорт — первой велосессии, иначе первой сессии;
 * `sessionStartedAt` — начало первой сессии, `sessionElapsedSec` — сумма `totalElapsedTime` сессий.
 * Записи без позиции (indoor, потеря GPS) в `points` не попадают, но учитываются во флагах пульса и мощности.
 */
export function parseFit(bytes: Uint8Array): ParsedTrack {
  let records: RecordMesg[];
  let sessions: SessionMesg[];
  try {
    const decoder = new Decoder(Stream.fromByteArray(bytes));
    if (!decoder.isFIT() || !decoder.checkIntegrity()) throw new TrackParseError('unreadable');
    const { messages, errors } = decoder.read({
      applyScaleAndOffset: true,
      expandSubFields: true,
      expandComponents: true,
      convertTypesToStrings: true,
      convertDateTimesToDates: true,
      includeUnknownData: false,
      mergeHeartRates: false,
      decodeMemoGlobs: false,
    });
    if (errors.length > 0) throw new TrackParseError('unreadable');
    records = messages.recordMesgs ?? [];
    sessions = messages.sessionMesgs ?? [];
  } catch (error) {
    if (error instanceof TrackParseError) throw error;
    throw new TrackParseError('unreadable');
  }

  const points: ParsedPoint[] = [];
  let hasHeartRate = false;
  let hasPower = false;
  for (const record of records) {
    const hr = positiveNumber(record.heartRate);
    const power = nonNegativeNumber(record.power);
    if (hr !== undefined) hasHeartRate = true;
    if (power !== undefined) hasPower = true;
    if (typeof record.positionLat !== 'number' || typeof record.positionLong !== 'number') continue;

    const point: ParsedPoint = {
      lat: record.positionLat * SEMICIRCLES_TO_DEGREES,
      lon: record.positionLong * SEMICIRCLES_TO_DEGREES,
    };
    if (record.timestamp instanceof Date) point.time = record.timestamp;
    const ele = finiteNumber(record.enhancedAltitude) ?? finiteNumber(record.altitude);
    if (ele !== undefined) point.ele = ele;
    if (hr !== undefined) point.hr = hr;
    if (power !== undefined) point.power = power;
    const cadence = positiveNumber(record.cadence);
    if (cadence !== undefined) point.cadence = cadence;
    points.push(point);
  }

  const track: ParsedTrack = {
    format: 'fit',
    sport: fitSport(sessions),
    points,
    hasHeartRate,
    hasPower,
  };
  const firstStart = sessions[0]?.startTime;
  if (firstStart instanceof Date) track.sessionStartedAt = firstStart;
  if (sessions.length > 0) {
    track.sessionElapsedSec = sessions.reduce(
      (sum, session) => sum + (finiteNumber(session.totalElapsedTime) ?? 0),
      0,
    );
  }
  return track;
}

function fitSport(sessions: readonly SessionMesg[]): ActivitySport {
  if (sessions.length === 0) return 'unknown';
  const session =
    sessions.find((item) => typeof item.sport === 'string' && CYCLING_SPORTS.has(item.sport)) ??
    sessions[0]!;
  if (typeof session.sport !== 'string' || !CYCLING_SPORTS.has(session.sport)) return 'other';
  return typeof session.subSport === 'string' && INDOOR_SUB_SPORTS.has(session.subSport)
    ? 'cycling_indoor'
    : 'cycling';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

/** Мощность 0 (накат) — отсчёт, не пропуск (race-results-07: флаги датчиков). */
function nonNegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}
