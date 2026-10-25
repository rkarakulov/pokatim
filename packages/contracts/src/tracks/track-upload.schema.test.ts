import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_SPORTS,
  TRACK_FAILURE_CODES,
  TRACK_FILE_EXTENSIONS,
  TRACK_FILE_MAX_BYTES,
  TRACK_FORMATS,
  TRACK_SOURCES,
  TRACK_UPLOAD_STATUSES,
  TrackUpload,
  TrackUploadName,
  TrackUploadPage,
  TrackUploadQuery,
} from './track-upload.schema.ts';

const upload = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
  source: 'upload',
  format: 'fit',
  fileName: 'morning.fit',
  status: 'ready',
  failure: null,
  createdAt: '2026-10-26T08:00:00.000Z',
  activity: {
    id: '01890a5d-ac96-774b-bcce-b302099a8058',
    sport: 'cycling',
    startedAt: '2026-10-26T06:00:00.000Z',
    elapsedSec: 3600,
    distanceM: 30123.4,
  },
};

describe('справочники треков (значения — только в конец)', () => {
  it('состав и порядок', () => {
    expect(TRACK_FILE_MAX_BYTES).toBe(16 * 1024 * 1024);
    expect(TRACK_FILE_EXTENSIONS).toEqual(['fit', 'gpx']);
    expect(TRACK_FORMATS).toEqual(['fit', 'gpx', 'stream']);
    expect(TRACK_SOURCES).toEqual(['upload', 'garmin', 'wahoo']);
    expect(TRACK_UPLOAD_STATUSES).toEqual([
      'queued',
      'processing',
      'ready',
      'failed',
      'duplicate',
      'skipped',
    ]);
    expect(TRACK_FAILURE_CODES).toEqual([
      'unreadable',
      'no_track',
      'no_timestamps',
      'implausible',
      'too_many_points',
      'timeout',
      'storage',
    ]);
    expect(ACTIVITY_SPORTS).toEqual(['cycling', 'cycling_indoor', 'other', 'unknown']);
  });
});

describe('TrackUpload (ответ приложения — tolerantEnum)', () => {
  it('разбор и незнакомые значения справочников → unknown', () => {
    expect(TrackUpload.parse(upload)).toEqual(upload);
    const future = TrackUpload.parse({
      ...upload,
      source: 'polar',
      format: 'tcx',
      status: 'archived',
      failure: 'virus',
      activity: { ...upload.activity, sport: 'rowing' },
    });
    expect(future).toMatchObject({
      source: 'unknown',
      format: 'unknown',
      status: 'unknown',
      failure: 'unknown',
      activity: { sport: 'unknown' },
    });
  });

  it('лишние поля сервера не выходят наружу (strip), активность может отсутствовать', () => {
    const parsed = TrackUpload.parse({ ...upload, sha256: 'x', storageKey: 'y', activity: null });
    expect(parsed).not.toHaveProperty('sha256');
    expect(parsed).not.toHaveProperty('storageKey');
    expect(parsed.activity).toBeNull();
  });

  it('страница — элементы и курсор', () => {
    expect(TrackUploadPage.parse({ items: [upload], nextCursor: null }).items).toHaveLength(1);
  });
});

describe('TrackUploadQuery (запрос — строгий)', () => {
  it('limit по умолчанию 20, из строки, 1…50', () => {
    expect(TrackUploadQuery.parse({})).toEqual({ limit: 20 });
    expect(TrackUploadQuery.parse({ limit: '5', cursor: 'abc' })).toEqual({
      limit: 5,
      cursor: 'abc',
    });
    expect(TrackUploadQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(TrackUploadQuery.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('лишний ключ и объект-оператор — ошибка', () => {
    expect(TrackUploadQuery.safeParse({ userId: 'x' }).success).toBe(false);
    expect(TrackUploadQuery.safeParse({ cursor: { $ne: null } }).success).toBe(false);
  });
});

describe('TrackUploadName (?name= — только для показа)', () => {
  it('обычное имя', () => {
    expect(TrackUploadName.parse('Утренний заезд.fit')).toBe('Утренний заезд.fit');
  });

  it('пути, управляющие символы, длина > 120, пустое — ошибка', () => {
    expect(TrackUploadName.safeParse('../etc/passwd').success).toBe(false);
    expect(TrackUploadName.safeParse('C:\\a.fit').success).toBe(false);
    expect(TrackUploadName.safeParse('a\u0000.fit').success).toBe(false);
    expect(TrackUploadName.safeParse('a\n.fit').success).toBe(false);
    expect(TrackUploadName.safeParse('x'.repeat(121)).success).toBe(false);
    expect(TrackUploadName.safeParse('').success).toBe(false);
  });
});
