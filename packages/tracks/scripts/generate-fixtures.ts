// Синтетические фикстуры FIT/GPX для тестов @pokatim/tracks (без персональных данных: маршруты — кольца вокруг
// центра Минска, устройства — только производитель). Детерминированно (без случайных чисел).
// Запуск из корня репо: pnpm exec node packages/tracks/scripts/generate-fixtures.ts
// Эталоны (`expected.json`) считаются здесь независимо от пакета: длина пути — в локальной плоскости по
// исходным (до квантования FIT) координатам, набор высоты — по построению профиля.
import { writeFileSync } from 'node:fs';

import {
  CrcCalculator,
  Encoder,
  Profile,
  type ActivityMesg,
  type DeveloperDataIdMesg,
  type EventMesg,
  type FieldDescriptionMesg,
  type FileIdMesg,
  type LapMesg,
  type RecordMesg,
  type SessionMesg,
} from '@garmin/fitsdk';

const OUT = new URL('../src/__fixtures__/', import.meta.url);
const CENTER = { lat: 53.9006, lon: 27.559 };
const START = Date.UTC(2026, 5, 14, 6, 0, 0); // 14.06.2026 09:00 по Минску
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
const DEG_TO_SEMICIRCLES = 2 ** 31 / 180;

interface Sample {
  time: Date;
  lat: number;
  lon: number;
  ele: number;
  distanceM: number;
  speed: number;
  hr: number;
  power: number;
  cadence: number;
}

interface RouteOptions {
  startMs: number;
  radiusM: number;
  speed: (second: number) => number;
  /** пауза: [начало, длительность] в секундах от старта — точки пишутся на месте */
  pause?: [number, number];
  /** сдвиг центра кольца, м (для второй сессии) */
  offset?: { east: number; north: number };
  climbs: number;
  climbM: number;
}

/** Кольцо с «волной» радиуса, 1 Гц, профиль высоты — `climbs` подъёмов по `climbM` м. */
function route(options: RouteOptions): { samples: Sample[]; lengthM: number; gainM: number } {
  const samples: Sample[] = [];
  const position = (phi: number) => {
    const r = options.radiusM + 0.06 * options.radiusM * Math.sin(3 * phi);
    return {
      x: (options.offset?.east ?? 0) + r * Math.sin(phi),
      y: (options.offset?.north ?? 0) + r * Math.cos(phi) - options.radiusM,
    };
  };
  let phi = 0;
  let lengthM = 0;
  let second = 0;
  let prev = position(0);
  while (phi < 2 * Math.PI) {
    const paused =
      options.pause !== undefined &&
      second >= options.pause[0] &&
      second < options.pause[0] + options.pause[1];
    const speed = paused ? 0 : options.speed(second);
    const point = prev;
    const ele = 200 + (options.climbM / 2) * (1 - Math.cos(options.climbs * phi));
    samples.push({
      time: new Date(options.startMs + second * 1000),
      lat: CENTER.lat + point.y / M_PER_DEG_LAT,
      lon: CENTER.lon + point.x / M_PER_DEG_LON,
      ele,
      distanceM: lengthM,
      speed,
      hr: Math.round(130 + 15 * Math.sin(second / 90)),
      power: Math.round(190 + 50 * Math.sin(second / 45)),
      cadence: paused ? 0 : Math.round(86 + 6 * Math.sin(second / 30)),
    });
    // шаг вдоль кривой на speed метров
    let remaining = speed;
    while (remaining > 0 && phi < 2 * Math.PI) {
      const dphi = Math.min(0.0005, 2 * Math.PI - phi);
      const next = position(phi + dphi);
      const step = Math.hypot(next.x - prev.x, next.y - prev.y);
      if (step > remaining) {
        const ratio = remaining / step;
        const partial = position(phi + dphi * ratio);
        lengthM += Math.hypot(partial.x - prev.x, partial.y - prev.y);
        phi += dphi * ratio;
        prev = partial;
        remaining = 0;
      } else {
        lengthM += step;
        phi += dphi;
        prev = next;
        remaining -= step;
      }
    }
    second += 1;
  }
  const end = position(2 * Math.PI);
  samples.push({
    ...samples[samples.length - 1]!,
    time: new Date(options.startMs + second * 1000),
    lat: CENTER.lat + end.y / M_PER_DEG_LAT,
    lon: CENTER.lon + end.x / M_PER_DEG_LON,
    distanceM: lengthM,
  });
  return { samples, lengthM, gainM: options.climbs * options.climbM };
}

interface FitSession {
  samples: Sample[];
  sport: SessionMesg['sport'];
  subSport: SessionMesg['subSport'];
  lengthM: number;
  gps: boolean;
  power: boolean;
  hr: boolean;
}

/** Developer-поле (как у Stryd/Connect IQ): декодер его отдаёт, пакет не читает. */
const DEVELOPER_DATA_ID: DeveloperDataIdMesg = {
  developerDataIndex: 0,
  applicationId: Array.from({ length: 16 }, (_, i) => i),
  applicationVersion: 1,
};
const FIELD_DESCRIPTION: FieldDescriptionMesg = {
  developerDataIndex: 0,
  fieldDefinitionNumber: 0,
  fitBaseTypeId: 132, // uint16
  fieldName: 'Form Power',
  units: 'watts',
};

function encodeFit(
  manufacturer: FileIdMesg['manufacturer'],
  product: number,
  sessions: FitSession[],
  developerField = false,
): Uint8Array {
  const encoder = developerField
    ? new Encoder({
        fieldDescriptions: {
          0: { developerDataIdMesg: DEVELOPER_DATA_ID, fieldDescriptionMesg: FIELD_DESCRIPTION },
        },
      })
    : new Encoder();
  const first = sessions[0]!.samples[0]!.time;
  const fileId: FileIdMesg = {
    type: 'activity',
    manufacturer,
    product,
    serialNumber: 1234567890,
    timeCreated: first,
  };
  encoder.onMesg(Profile.MesgNum.FILE_ID!, fileId);
  if (developerField) {
    encoder.onMesg(Profile.MesgNum.DEVELOPER_DATA_ID!, DEVELOPER_DATA_ID);
    encoder.onMesg(Profile.MesgNum.FIELD_DESCRIPTION!, FIELD_DESCRIPTION);
  }
  const timerStart: EventMesg = { timestamp: first, event: 'timer', eventType: 'start' };
  encoder.onMesg(Profile.MesgNum.EVENT!, timerStart);
  let last = first;
  for (const session of sessions) {
    for (const sample of session.samples) {
      const record: RecordMesg = {
        timestamp: sample.time,
        altitude: sample.ele,
        distance: sample.distanceM,
        speed: sample.speed,
        cadence: sample.cadence,
      };
      if (session.gps) {
        record.positionLat = Math.round(sample.lat * DEG_TO_SEMICIRCLES);
        record.positionLong = Math.round(sample.lon * DEG_TO_SEMICIRCLES);
      }
      if (session.hr) record.heartRate = sample.hr;
      if (session.power) record.power = sample.power;
      if (developerField) record.developerFields = { 0: sample.power };
      encoder.onMesg(Profile.MesgNum.RECORD!, record);
    }
    const start = session.samples[0]!.time;
    const end = session.samples[session.samples.length - 1]!.time;
    const elapsed = (end.getTime() - start.getTime()) / 1000;
    const summary: SessionMesg & LapMesg = {
      timestamp: end,
      startTime: start,
      totalElapsedTime: elapsed,
      totalTimerTime: elapsed,
      totalDistance: session.lengthM,
      sport: session.sport,
      subSport: session.subSport,
    };
    const lap: LapMesg = { ...summary, messageIndex: 0 };
    const sessionMesg: SessionMesg = {
      ...summary,
      messageIndex: sessions.indexOf(session),
      firstLapIndex: 0,
      numLaps: 1,
    };
    encoder.onMesg(Profile.MesgNum.LAP!, lap);
    encoder.onMesg(Profile.MesgNum.SESSION!, sessionMesg);
    last = end;
  }
  const timerStop: EventMesg = { timestamp: last, event: 'timer', eventType: 'stopAll' };
  const activity: ActivityMesg = {
    timestamp: last,
    numSessions: sessions.length,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  };
  encoder.onMesg(Profile.MesgNum.EVENT!, timerStop);
  encoder.onMesg(Profile.MesgNum.ACTIVITY!, activity);
  return encoder.close();
}

/**
 * FIT, где записи после первой идут со сжатым заголовком времени (compressed timestamp header, FIT §4.2.1.3):
 * Encoder SDK такие не пишет — байты собираются вручную.
 */
function compressedTimestampFit(): Uint8Array {
  const data: number[] = [];
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const fitTime = Math.round((START - 631_065_600_000) / 1000);
  // определение local 0: file_id { type: enum }
  data.push(0x40, 0, 0, ...u16(0), 1, 0, 1, 0x00);
  data.push(0x00, 4); // type = activity
  // определение local 1: record { timestamp uint32, position_lat sint32, position_long sint32 }
  data.push(0x41, 0, 0, ...u16(20), 3, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85);
  // определение local 2: record { position_lat, position_long } — время из сжатого заголовка
  data.push(0x42, 0, 0, ...u16(20), 2, 0, 4, 0x85, 1, 4, 0x85);
  const lat = (i: number) => Math.round((CENTER.lat + i * 0.0001) * DEG_TO_SEMICIRCLES);
  const lon = Math.round(CENTER.lon * DEG_TO_SEMICIRCLES);
  data.push(0x01, ...u32(fitTime), ...u32(lat(0)), ...u32(lon));
  for (let i = 1; i <= 20; i += 1) {
    data.push(0x80 | (2 << 5) | ((fitTime + i) & 0x1f), ...u32(lat(i)), ...u32(lon));
  }
  const header = [14, 0x20, ...u16(2180), ...u32(data.length), 0x2e, 0x46, 0x49, 0x54];
  const headerBytes = new Uint8Array(header);
  header.push(...u16(CrcCalculator.calculateCRC(headerBytes, 0, 12)));
  const body = new Uint8Array([...header, ...data]);
  const crc = CrcCalculator.calculateCRC(body, 0, body.length);
  return new Uint8Array([...body, ...u16(crc)]);
}

// --- GPX ---

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

function gpxDocument(options: {
  creator: string;
  type?: string;
  samples: Sample[];
  point: (sample: Sample) => string;
  namespaces?: string;
}): string {
  const points = options.samples.map(options.point).join('\n');
  const type = options.type === undefined ? '' : `\n    <type>${options.type}</type>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${options.creator}" xmlns="http://www.topografix.com/GPX/1/1"${options.namespaces ?? ''}>
  <metadata><time>${iso(options.samples[0]!.time)}</time></metadata>
  <trk>
    <name>Синтетический заезд</name>${type}
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

const trkpt = (sample: Sample, inner: string) =>
  `      <trkpt lat="${sample.lat.toFixed(7)}" lon="${sample.lon.toFixed(7)}">${inner}</trkpt>`;
const basic = (sample: Sample) =>
  `<ele>${sample.ele.toFixed(1)}</ele><time>${iso(sample.time)}</time>`;

function write(name: string, content: Uint8Array | string): void {
  writeFileSync(new URL(name, OUT), content);
}

const expected: Record<string, unknown> = {};

// Garmin Edge: ≈ 30 км, 1 Гц, мощность и пульс, пауза 2 мин на 30-й минуте
const edge = route({
  startMs: START,
  radiusM: 4750,
  speed: (s) => 7.5 + 1.5 * Math.sin(s / 150),
  pause: [1800, 120],
  climbs: 4,
  climbM: 40,
});
const edgeFit = encodeFit('garmin', 3843 /* edge1040 */, [
  { ...edge, sport: 'cycling', subSport: 'road', gps: true, power: true, hr: true },
]);
write('garmin-edge-ride.fit', edgeFit);
expected['garmin-edge-ride.fit'] = {
  distanceM: edge.lengthM,
  elapsedSec: edge.samples.length - 1,
  pauseSec: 120,
  elevationGainM: edge.gainM,
  points: edge.samples.length,
};

// Wahoo ELEMNT: ≈ 15 км, пульс без мощности
const wahoo = route({
  startMs: START + 86_400_000,
  radiusM: 2400,
  speed: () => 6.5,
  climbs: 2,
  climbM: 20,
});
write(
  'wahoo-elemnt-ride.fit',
  encodeFit(
    'wahooFitness',
    31,
    [{ ...wahoo, sport: 'cycling', subSport: 'road', gps: true, power: false, hr: true }],
    true,
  ),
);
expected['wahoo-elemnt-ride.fit'] = {
  distanceM: wahoo.lengthM,
  elapsedSec: wahoo.samples.length - 1,
  elevationGainM: wahoo.gainM,
  points: wahoo.samples.length,
};

// Часы, бег ≈ 5 км
const run = route({ startMs: START, radiusM: 800, speed: () => 3, climbs: 1, climbM: 10 });
write(
  'watch-run.fit',
  encodeFit('garmin', 3990 /* fr255 */, [
    { ...run, sport: 'running', subSport: 'generic', gps: true, power: false, hr: true },
  ]),
);
expected['watch-run.fit'] = { distanceM: run.lengthM, points: run.samples.length };

// Велостанок без GPS: 30 мин
const indoor = route({ startMs: START, radiusM: 2000, speed: () => 7, climbs: 1, climbM: 0 });
const indoorSamples = indoor.samples.slice(0, 1800);
write(
  'indoor-trainer.fit',
  encodeFit('garmin', 3843, [
    {
      samples: indoorSamples,
      lengthM: indoorSamples[indoorSamples.length - 1]!.distanceM,
      sport: 'cycling',
      subSport: 'indoorCycling',
      gps: false,
      power: true,
      hr: true,
    },
  ]),
);

// Две сессии: бег ≈ 2 км, затем вело ≈ 10 км (мультиспорт)
const firstLeg = route({ startMs: START, radiusM: 320, speed: () => 3.2, climbs: 1, climbM: 4 });
const secondStart = firstLeg.samples[firstLeg.samples.length - 1]!.time.getTime() + 1000;
const secondLeg = route({
  startMs: secondStart,
  radiusM: 1600,
  speed: () => 7,
  climbs: 1,
  climbM: 10,
});
write(
  'two-sessions.fit',
  encodeFit('garmin', 3990, [
    { ...firstLeg, sport: 'running', subSport: 'generic', gps: true, power: false, hr: true },
    { ...secondLeg, sport: 'cycling', subSport: 'road', gps: true, power: false, hr: true },
  ]),
);
expected['two-sessions.fit'] = {
  distanceM: firstLeg.lengthM + secondLeg.lengthM,
  points: firstLeg.samples.length + secondLeg.samples.length,
};

write('compressed-timestamp.fit', compressedTimestampFit());

// Порча: байт в середине данных (CRC не сходится) и обрезанный файл
const corrupted = edgeFit.slice();
const middle = Math.floor(corrupted.length / 2);
corrupted[middle] = corrupted[middle]! ^ 0xff;
write('corrupted-crc.fit', corrupted);
write('truncated.fit', edgeFit.slice(0, Math.floor(edgeFit.length * 0.6)));

// GPX: ≈ 6 км, 1 Гц
const short = route({ startMs: START, radiusM: 1000, speed: () => 7, climbs: 2, climbM: 12 });
expected['gpx'] = {
  distanceM: short.lengthM,
  elapsedSec: short.samples.length - 1,
  points: short.samples.length,
};

write(
  'garmin-connect.gpx',
  gpxDocument({
    creator: 'Garmin Connect',
    type: 'cycling',
    namespaces:
      ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    samples: short.samples,
    point: (s) =>
      trkpt(
        s,
        `${basic(s)}<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${s.hr}</gpxtpx:hr><gpxtpx:cad>${s.cadence}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>`,
      ),
  }),
);
write(
  'komoot.gpx',
  gpxDocument({ creator: 'komoot', samples: short.samples, point: (s) => trkpt(s, basic(s)) }),
);
write(
  'strava.gpx',
  gpxDocument({
    creator: 'StravaGPX',
    type: '1',
    namespaces: ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"',
    samples: short.samples,
    point: (s) =>
      trkpt(
        s,
        `${basic(s)}<extensions><power>${s.power}</power><gpxtpx:TrackPointExtension><gpxtpx:hr>${s.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
      ),
  }),
);
write(
  'no-time.gpx',
  gpxDocument({
    creator: 'test',
    type: 'cycling',
    samples: short.samples,
    point: (s) => trkpt(s, `<ele>${s.ele.toFixed(1)}</ele>`),
  }),
);
write(
  'empty-trk.gpx',
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="53.9006" lon="27.559"><name>Точка</name></wpt>
  <rte><rtept lat="53.9006" lon="27.559"/><rtept lat="53.91" lon="27.57"/></rte>
  <trk><name>Пусто</name><trkseg></trkseg></trk>
</gpx>
`,
);
write(
  'zero-points.gpx',
  gpxDocument({
    creator: 'test',
    type: 'cycling',
    samples: short.samples,
    // две трети точек — (0,0): «нет фикса» у дешёвых трекеров
    point: (s) =>
      short.samples.indexOf(s) % 3 === 0
        ? trkpt(s, basic(s))
        : `      <trkpt lat="0" lon="0">${basic(s)}</trkpt>`,
  }),
);
write(
  'reversed-time.gpx',
  gpxDocument({
    creator: 'test',
    type: 'cycling',
    samples: short.samples,
    point: (s) =>
      trkpt(
        s,
        basic({
          ...s,
          time: short.samples[short.samples.length - 1 - short.samples.indexOf(s)]!.time,
        }),
      ),
  }),
);
write(
  'xxe.gpx',
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE gpx [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>&xxe;</name><trkseg>
    <trkpt lat="53.9006" lon="27.559"><time>2026-06-14T06:00:00Z</time></trkpt>
    <trkpt lat="53.9106" lon="27.569"><time>2026-06-14T06:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>
`,
);
const lolEntities = Array.from(
  { length: 9 },
  (_, i) => `  <!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`,
).join('\n');
write(
  'billion-laughs.gpx',
  `<?xml version="1.0"?>
<!DOCTYPE gpx [
  <!ENTITY lol0 "lol">
${lolEntities}
]>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>&lol9;</name><trkseg>
    <trkpt lat="53.9006" lon="27.559"><time>2026-06-14T06:00:00Z</time></trkpt>
    <trkpt lat="53.9106" lon="27.569"><time>2026-06-14T06:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>
`,
);

// Поток агрегатора pokatim.stream.v1 (Open Wearables): тот же ≈ 6 км заезд, [unix ms, lat, lon, ele | null]
// вывод — в раскладке prettier (точка на строку), чтобы `prettier --check` не трогал фикстуру
const streamHeader = JSON.stringify(
  { v: 1, provider: 'garmin', sport: 'road_cycling', hasHeartRate: true, hasPower: false },
  null,
  2,
).slice(0, -2);
const streamPoints = short.samples
  .map((s, i) => {
    const ele = i % 10 === 0 ? null : Number(s.ele.toFixed(1));
    const values = [s.time.getTime(), Number(s.lat.toFixed(7)), Number(s.lon.toFixed(7)), ele];
    return `    [${values.map(String).join(', ')}]`;
  })
  .join(',\n');
write('ow-stream.json', `${streamHeader},\n  "points": [\n${streamPoints}\n  ]\n}\n`);

write('expected.json', `${JSON.stringify(expected, null, 2)}\n`);
process.stdout.write(`fixtures: ${Object.keys(expected).join(', ')}\n`);
