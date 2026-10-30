// Синтетические фикстуры TCX и KMZ маршрутов (routes-formats) в раскладке экспортёров: курс Garmin Connect
// (Folders/CourseFolder + Courses/Course: Lap, Track/Trackpoint с Time, Position, AltitudeMeters, DistanceMeters,
// CoursePoint), активность Garmin (Activities/Activity/Lap/Track, несколько Track, Trackpoint без Position, Extensions)
// и KMZ Google Earth (zip: doc.kml + files/icon.png, deflate, флаг 3 — нулевые размеры в локальном заголовке и data
// descriptor). Без персональных данных: линии вокруг Минска. Детерминированно.
// Запуск из корня репо — после generate-fixtures.ts и generate-kml-fixtures.ts (первый перезаписывает expected.json
// целиком, второй и этот — читают и дописывают свои ключи):
//   pnpm exec node packages/tracks/scripts/generate-route-format-fixtures.ts
// Эталоны (`expected.json`, ключи `*.tcx`, `*.kmz`) считаются здесь независимо от пакета: длина — сумма
// гаверсинусов по точкам в порядке документа, набор высоты — по построению профиля. Zip собирается здесь же
// (`deflateRawSync` + `crc32`), не кодом пакета.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

const OUT = new URL('../src/__fixtures__/', import.meta.url);
const R = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

type P = { lon: number; lat: number; ele?: number };

function haversine(a: P, b: P): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const lengthOf = (points: readonly P[]) =>
  points.reduce((sum, p, i) => (i === 0 ? 0 : sum + haversine(points[i - 1]!, p)), 0);

const fixed = (n: number) => Number(n.toFixed(6));

/** Ломаная «на восток с волной» с одним холмом высотой `hill` м (набор `hill`): `count` точек от (lon0, lat0). */
function hilly(count: number, lon0: number, lat0: number, hill: number): P[] {
  return Array.from({ length: count }, (_, i) => ({
    lon: fixed(lon0 + i * 0.0006),
    lat: fixed(lat0 + 0.002 * Math.sin(i / 15)),
    ele: Number((200 + (hill / 2) * (1 - Math.cos((2 * Math.PI * i) / (count - 1)))).toFixed(1)),
  }));
}

/** Петля радиусом ~1,6 км с двумя подъёмами по 20 м (набор 40 м). */
function loop(count: number): P[] {
  return Array.from({ length: count }, (_, i) => {
    const phi = (2 * Math.PI * i) / (count - 1);
    return {
      lon: fixed(27.45 + 0.024 * Math.sin(phi)),
      lat: fixed(53.93 + 0.0145 * Math.cos(phi) - 0.0145),
      ele: Number((210 + 10 * (1 - Math.cos(2 * phi))).toFixed(1)),
    };
  });
}

const expected = JSON.parse(readFileSync(new URL('expected.json', OUT), 'utf8')) as Record<
  string,
  unknown
>;
const write = (name: string, content: string | Uint8Array) =>
  writeFileSync(new URL(name, OUT), content);
const utf8 = (text: string) => new TextEncoder().encode(text);

const T0 = Date.UTC(2026, 5, 14, 6, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');
const TCX_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<TrainingCenterDatabase xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd" xmlns:ns5="http://www.garmin.com/xmlschemas/ActivityGoals/v1" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns:ns2="http://www.garmin.com/xmlschemas/UserProfile/v2" xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns4="http://www.garmin.com/xmlschemas/ProfileExtension/v1">`;

const position = (p: P) =>
  `<Position><LatitudeDegrees>${p.lat}</LatitudeDegrees><LongitudeDegrees>${p.lon}</LongitudeDegrees></Position>`;

// Garmin Connect «Экспорт курса в TCX»: папка курсов, курс с итогами круга, точки с накопленной дистанцией, CoursePoint
const course = hilly(300, 27.56, 53.9, 30);
let courseDistance = 0;
const courseTrackpoints = course.map((p, i) => {
  if (i > 0) courseDistance += haversine(course[i - 1]!, p);
  return `          <Trackpoint>
            <Time>${iso(T0 + i * 5000)}</Time>
            ${position(p)}
            <AltitudeMeters>${p.ele}</AltitudeMeters>
            <DistanceMeters>${courseDistance.toFixed(1)}</DistanceMeters>
          </Trackpoint>`;
});
write(
  'route-garmin-course.tcx',
  `${TCX_HEAD}
  <Folders>
    <Courses>
      <CourseFolder Name="Courses">
        <CourseNameRef>
          <Id>Холм за городом</Id>
        </CourseNameRef>
      </CourseFolder>
    </Courses>
  </Folders>
  <Courses>
    <Course>
      <Name>Холм за городом</Name>
      <Lap>
        <TotalTimeSeconds>${(course.length - 1) * 5}.0</TotalTimeSeconds>
        <DistanceMeters>${courseDistance.toFixed(1)}</DistanceMeters>
        <BeginPosition><LatitudeDegrees>${course[0]!.lat}</LatitudeDegrees><LongitudeDegrees>${course[0]!.lon}</LongitudeDegrees></BeginPosition>
        <EndPosition><LatitudeDegrees>${course.at(-1)!.lat}</LatitudeDegrees><LongitudeDegrees>${course.at(-1)!.lon}</LongitudeDegrees></EndPosition>
        <Intensity>Active</Intensity>
      </Lap>
      <Track>
${courseTrackpoints.join('\n')}
      </Track>
      <CoursePoint>
        <Name>Вода</Name>
        <Time>${iso(T0 + 100 * 5000)}</Time>
        ${position({ lon: 27.61, lat: 53.91 })}
        <PointType>Water</PointType>
      </CoursePoint>
    </Course>
  </Courses>
  <Author xsi:type="Application_t">
    <Name>Garmin Connect API</Name>
    <Build><Version><VersionMajor>16</VersionMajor><VersionMinor>2</VersionMinor></Version></Build>
    <LangID>ru</LangID>
    <PartNumber>006-D2449-00</PartNumber>
  </Author>
</TrainingCenterDatabase>
`,
);
expected['route-garmin-course.tcx'] = {
  distanceM: lengthOf(course),
  elevationGainM: 30,
  points: course.length,
};

// Garmin (активность): два круга; в первом — два Track (пауза), точки без Position (пульс без GPS), Extensions
const lap1a = hilly(100, 27.5, 53.88, 0).map((p) => ({ ...p, ele: 215 }));
const lap1b = hilly(50, 27.56, 53.88, 0).map((p) => ({ ...p, ele: 215 }));
const lap2 = hilly(80, 27.59, 53.88, 0).map((p) => ({ ...p, ele: 215 }));
let activityMs = T0;
const activityPoint = (p: P | null) => {
  activityMs += 1000;
  const hr = `<HeartRateBpm><Value>132</Value></HeartRateBpm>`;
  const ext = `<Extensions><ns3:TPX><ns3:Speed>6.5</ns3:Speed><ns3:Watts>180</ns3:Watts></ns3:TPX></Extensions>`;
  return p === null
    ? `<Trackpoint><Time>${iso(activityMs)}</Time>${hr}</Trackpoint>`
    : `<Trackpoint><Time>${iso(activityMs)}</Time>${position(p)}<AltitudeMeters>${p.ele}</AltitudeMeters>${hr}${ext}</Trackpoint>`;
};
const track = (points: readonly P[], gapsAt: readonly number[]) =>
  `<Track>\n${points
    .flatMap((p, i) =>
      gapsAt.includes(i) ? [activityPoint(null), activityPoint(p)] : [activityPoint(p)],
    )
    .join('\n')}\n</Track>`;
const lapOf = (body: string) =>
  `<Lap StartTime="${iso(activityMs)}"><TotalTimeSeconds>120.0</TotalTimeSeconds><DistanceMeters>1000.0</DistanceMeters><Calories>30</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>${body}</Lap>`;
const activityLap1 = lapOf(`${track(lap1a, [0, 40, 41])}\n${track(lap1b, [])}`);
const activityLap2 = lapOf(track(lap2, [10, 79]));
write(
  'route-garmin-activity.tcx',
  `${TCX_HEAD}
<Activities>
<Activity Sport="Biking">
<Id>${iso(T0)}</Id>
${activityLap1}
${activityLap2}
<Creator xsi:type="Device_t"><Name>Edge 530</Name><UnitId>1</UnitId><ProductID>3121</ProductID></Creator>
</Activity>
</Activities>
</TrainingCenterDatabase>
`,
);
const activity = [...lap1a, ...lap1b, ...lap2];
expected['route-garmin-activity.tcx'] = {
  distanceM: lengthOf(activity),
  elevationGainM: 0,
  points: activity.length,
};

write(
  'route-no-points.tcx',
  `${TCX_HEAD}
  <Courses><Course><Name>Пусто</Name><Track/></Course></Courses>
</TrainingCenterDatabase>
`,
);
write(
  'route-dtd.tcx',
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE TrainingCenterDatabase [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Courses><Course><Name>&xxe;</Name><Track>
    <Trackpoint>${position({ lon: 27.559, lat: 53.9006 })}</Trackpoint>
    <Trackpoint>${position({ lon: 27.569, lat: 53.9106 })}</Trackpoint>
  </Track></Course></Courses>
</TrainingCenterDatabase>
`,
);

// ---- KMZ ----

interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** 0 — stored, 8 — deflate; `rawMethod` — значение поля метода как есть (неизвестный метод) */
  method: 0 | 8;
  rawMethod?: number;
  /** бит 3 — data descriptor (нули в локальном заголовке), бит 0 — шифрование */
  flags?: number;
  /** ложные поля центрального заголовка */
  crc?: number;
  uncompressedSize?: number;
  compressedSize?: number;
  /** extra-поле локального заголовка (у центрального — пустое): длины extra различаются */
  localExtra?: Uint8Array;
}

/** Zip одного тома: локальные заголовки и данные → central directory → EOCD (без zip64). */
function zip(entries: readonly ZipEntry[], options: { eocdEntries?: number } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    offset += chunk.length;
  };
  for (const entry of entries) {
    const name = utf8(entry.name);
    const body = entry.method === 8 ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const crc = entry.crc ?? crc32(entry.data);
    const uncompressed = entry.uncompressedSize ?? entry.data.length;
    const compressed = entry.compressedSize ?? body.length;
    const flags = entry.flags ?? 0;
    const method = entry.rawMethod ?? entry.method;
    const descriptor = (flags & 0x08) !== 0;
    const extra = entry.localExtra ?? new Uint8Array();

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0x3000, true); // 06:00
    lv.setUint16(12, 0x5ace, true); // 14.06.2025
    lv.setUint32(14, descriptor ? 0 : crc, true);
    lv.setUint32(18, descriptor ? 0 : compressed, true);
    lv.setUint32(22, descriptor ? 0 : uncompressed, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    const localOffset = offset;
    push(local);
    push(name);
    push(extra);
    push(body);
    if (descriptor) {
      const dd = new Uint8Array(16);
      const dv = new DataView(dd.buffer);
      dv.setUint32(0, 0x08074b50, true);
      dv.setUint32(4, crc, true);
      dv.setUint32(8, compressed, true);
      dv.setUint32(12, uncompressed, true);
      push(dd);
    }

    const header = new Uint8Array(46);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0x3000, true);
    cv.setUint16(14, 0x5ace, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, uncompressed, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, localOffset, true);
    central.push(header, name);
  }
  const cdOffset = offset;
  for (const chunk of central) push(chunk);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  const count = options.eocdEntries ?? entries.length;
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, offset - cdOffset, true);
  ev.setUint32(16, cdOffset, true);
  push(eocd);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** «Картинка» значка: сигнатура PNG и немного байт (не разбирается). */
const icon = Uint8Array.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(64).fill(7),
]);
/** extended timestamp `UT` (5 байт данных) — пишет zip Google Earth в локальном заголовке */
const utExtra = Uint8Array.from([0x55, 0x54, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00]);

// Google Earth Pro «Сохранить место как… KMZ»: doc.kml со стилем и значком из архива, LineString с высотами
const earthLine = loop(400);
const earthDoc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
	<name>Кольцо.kmz</name>
	<Style id="s_ylw-pushpin">
		<IconStyle><Icon><href>files/icon.png</href></Icon></IconStyle>
		<LineStyle><color>ff00aaff</color><width>4</width></LineStyle>
	</Style>
	<Placemark>
		<name>Кольцо</name>
		<styleUrl>#s_ylw-pushpin</styleUrl>
		<LineString>
			<tessellate>1</tessellate>
			<altitudeMode>clampToGround</altitudeMode>
			<coordinates>
				${earthLine.map((p) => `${p.lon},${p.lat},${p.ele}`).join(' ')}
			</coordinates>
		</LineString>
	</Placemark>
</Document>
</kml>
`;
// doc.kml архива — отдельно, в подпапке (эталон теста «KMZ = его doc.kml»; golden simplify читает только корень
// `__fixtures__` и `corridor/`)
mkdirSync(new URL('route-earth-kmz/', OUT), { recursive: true });
write('route-earth-kmz/doc.kml', earthDoc);
write(
  'route-earth.kmz',
  zip([
    { name: 'doc.kml', data: utf8(earthDoc), method: 8, flags: 0x08, localExtra: utExtra },
    { name: 'files/icon.png', data: icon, method: 0, flags: 0x08, localExtra: utExtra },
  ]),
);
expected['route-earth.kmz'] = {
  distanceM: lengthOf(earthLine),
  elevationGainM: 40,
  points: earthLine.length,
};

// без doc.kml: KML в папке пропускается, берётся первый `.kml` в корне по порядку central directory
const firstLine = hilly(120, 27.6, 53.86, 0).map(({ lon, lat }) => ({ lon, lat }));
const lineKml = (points: readonly P[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>${points
    .map((p) => `${p.lon},${p.lat}`)
    .join(' ')}</coordinates></LineString></Placemark></Document></kml>
`;
write(
  'route-no-doc.kmz',
  zip([
    { name: 'files/icon.png', data: icon, method: 0 },
    { name: 'layers/doc.kml', data: utf8(lineKml(hilly(30, 27.4, 53.8, 0))), method: 8 },
    { name: 'Route.KML', data: utf8(lineKml(firstLine)), method: 0 },
    { name: 'second.kml', data: utf8(lineKml(hilly(40, 27.7, 53.85, 0))), method: 8 },
  ]),
);
expected['route-no-doc.kmz'] = { distanceM: lengthOf(firstLine), points: firstLine.length };

const smallKml = utf8(lineKml(hilly(30, 27.6, 53.86, 0)));
write('route-no-kml.kmz', zip([{ name: 'files/icon.png', data: icon, method: 8 }]));
write('route-encrypted.kmz', zip([{ name: 'doc.kml', data: smallKml, method: 0, flags: 0x01 }]));
write('route-method12.kmz', zip([{ name: 'doc.kml', data: smallKml, method: 0, rawMethod: 12 }]));
write(
  'route-zip64.kmz',
  zip([{ name: 'doc.kml', data: smallKml, method: 8, uncompressedSize: 0xffffffff }]),
);
write('route-bad-crc.kmz', zip([{ name: 'doc.kml', data: smallKml, method: 8, crc: 0x12345678 }]));
write(
  'route-dtd-inside.kmz',
  zip([
    {
      name: 'doc.kml',
      data: utf8(
        `<?xml version="1.0"?>\n<!DOCTYPE kml [ <!ENTITY x "y"> ]>\n${lineKml(hilly(30, 27.6, 53.86, 0)).replace(/^<\?xml[^>]*>\n/, '')}`,
      ),
      method: 8,
    },
  ]),
);
// zip-бомба: 17 МиБ пробелов в KML (≈ 17 КиБ в архиве) — честный размер в central directory и ложный: ровно предел
// 16 МиБ (проходит проверку объявленного размера — отказ даёт только `maxOutputLength` распаковки)
const bomb = new Uint8Array(17 * 1024 * 1024).fill(0x20);
bomb.set(utf8('<kml>'), 0);
write('route-bomb.kmz', zip([{ name: 'doc.kml', data: bomb, method: 8 }]));
write(
  'route-bomb-lying.kmz',
  zip([{ name: 'doc.kml', data: bomb, method: 8, uncompressedSize: 16 * 1024 * 1024 }]),
);
// миллионы пустых элементов в KML (≈ 4,4 МБ распакованно, единицы КиБ в архиве): отказ подсчётом элементов маршрута до
// разбора в дерево, не падение потока по памяти
const manyElements = utf8(`<kml><Document>${'<a/>'.repeat(1_100_000)}</Document></kml>`);
write('route-many-elements.kmz', zip([{ name: 'doc.kml', data: manyElements, method: 8 }]));

write('expected.json', `${JSON.stringify(expected, null, 2)}\n`);
process.stdout.write('route format fixtures: done\n');
