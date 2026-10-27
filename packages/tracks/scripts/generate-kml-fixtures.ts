// Синтетические фикстуры KML маршрутов (routes-02) в раскладке экспортёров: Google My Maps («Экспорт в KML»:
// Document/Folder/Placemark, LineString с высотой 0 у каждой точки, метки Point) и Google Earth Pro (gx:Track с
// when/gx:coord и высотами). Без персональных данных: линии вокруг Минска. Детерминированно.
// Запуск из корня репо: pnpm exec node packages/tracks/scripts/generate-kml-fixtures.ts
// Эталоны (`expected.json`, ключи `*.kml`) считаются здесь независимо от пакета: длина — сумма гаверсинусов по
// точкам в порядке документа, набор высоты — по построению профиля.
import { readFileSync, writeFileSync } from 'node:fs';

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

/** Ломаная «на восток с волной»: `count` точек от (lon0, lat0). */
function wavy(count: number, lon0: number, lat0: number): P[] {
  return Array.from({ length: count }, (_, i) => ({
    lon: fixed(lon0 + i * 0.0006),
    lat: fixed(lat0 + 0.002 * Math.sin(i / 15)),
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

// Google My Maps: метка старта до линии, линия с `,0`, метка финиша
const myMaps = wavy(240, 27.52, 53.88);
write(
  'route-mymaps.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Покатушка за город</name>
    <description/>
    <Style id="icon-1899-0288D1-normal">
      <IconStyle>
        <color>ffd18802</color>
        <scale>1</scale>
        <Icon>
          <href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="line-000000-1200-nodesc-normal">
      <LineStyle>
        <color>ff000000</color>
        <width>1.2</width>
      </LineStyle>
    </Style>
    <Folder>
      <name>Безымянный слой</name>
      <Placemark>
        <name>Старт</name>
        <styleUrl>#icon-1899-0288D1-normal</styleUrl>
        <Point>
          <coordinates>
            27.5,53.9,0
          </coordinates>
        </Point>
      </Placemark>
      <Placemark>
        <name>Линия 1</name>
        <styleUrl>#line-000000-1200-nodesc-normal</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>
${myMaps.map((p) => `            ${p.lon},${p.lat},0`).join('\n')}
          </coordinates>
        </LineString>
      </Placemark>
      <Placemark>
        <name>Финиш</name>
        <styleUrl>#icon-1899-0288D1-normal</styleUrl>
        <Point>
          <coordinates>
            27.7,53.95,0
          </coordinates>
        </Point>
      </Placemark>
    </Folder>
  </Document>
</kml>
`,
);
expected['route-mymaps.kml'] = { distanceM: lengthOf(myMaps), points: myMaps.length };

// Google Earth Pro: gx:Track (when + gx:coord «lon lat alt»), петля с высотами
const earth = loop(400);
const t0 = Date.UTC(2026, 5, 14, 6, 0, 0);
write(
  'route-earth-gxtrack.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
	<name>Кольцо.kml</name>
	<Style id="multiTrack_n">
		<IconStyle>
			<Icon>
				<href>http://earth.google.com/images/kml-icons/track-directional/track-0.png</href>
			</Icon>
		</IconStyle>
		<LineStyle>
			<color>99ffac59</color>
			<width>6</width>
		</LineStyle>
	</Style>
	<Placemark>
		<name>Кольцо</name>
		<styleUrl>#multiTrack_n</styleUrl>
		<gx:Track>
			<altitudeMode>clampToGround</altitudeMode>
${earth.map((_, i) => `			<when>${new Date(t0 + i * 5000).toISOString().replace('.000', '')}</when>`).join('\n')}
${earth.map((p) => `			<gx:coord>${p.lon} ${p.lat} ${p.ele}</gx:coord>`).join('\n')}
			<ExtendedData>
				<SchemaData schemaUrl="#schema">
					<gx:SimpleArrayData name="speed"><gx:value>5</gx:value></gx:SimpleArrayData>
				</SchemaData>
			</ExtendedData>
		</gx:Track>
	</Placemark>
</Document>
</kml>
`,
);
expected['route-earth-gxtrack.kml'] = {
  distanceM: lengthOf(earth),
  elevationGainM: 40,
  points: earth.length,
};

// без третьей координаты, кортежи через пробел в одну строку
const noAlt = wavy(120, 27.6, 53.86);
write(
  'route-no-alt.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Без высот</name><LineString><coordinates>${noAlt
    .map((p) => `${p.lon},${p.lat}`)
    .join(' ')}</coordinates></LineString></Placemark></Document></kml>
`,
);
expected['route-no-alt.kml'] = { distanceM: lengthOf(noAlt), points: noAlt.length };

// две линии в MultiGeometry + метка: склейка в порядке документа
const first = wavy(60, 27.5, 53.9);
const second = wavy(80, 27.54, 53.9);
write(
  'route-multigeometry.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Две части</name>
      <MultiGeometry>
        <LineString>
          <coordinates>${first.map((p) => `${p.lon},${p.lat},215`).join(' ')}</coordinates>
        </LineString>
        <Point><coordinates>27.53,53.9,0</coordinates></Point>
        <LineString>
          <coordinates>${second.map((p) => `${p.lon},${p.lat},215`).join(' ')}</coordinates>
        </LineString>
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>
`,
);
expected['route-multigeometry.kml'] = {
  distanceM: lengthOf([...first, ...second]),
  elevationGainM: 0,
  points: first.length + second.length,
};

write(
  'route-points-only.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark><name>Кофейня</name><Point><coordinates>27.55,53.9,0</coordinates></Point></Placemark>
    <Placemark><name>Парковка</name><Point><coordinates>27.56,53.91,0</coordinates></Point></Placemark>
  </Document>
</kml>
`,
);
write(
  'empty.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>
`,
);
write(
  'xxe.kml',
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE kml [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>&xxe;</name><LineString><coordinates>27.559,53.9006 27.569,53.9106</coordinates></LineString></Placemark>
</kml>
`,
);
const lolEntities = Array.from(
  { length: 9 },
  (_, i) => `  <!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`,
).join('\n');
write(
  'billion-laughs.kml',
  `<?xml version="1.0"?>
<!DOCTYPE kml [
  <!ENTITY lol0 "lol">
${lolEntities}
]>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>&lol9;</name><LineString><coordinates>27.559,53.9006 27.569,53.9106</coordinates></LineString></Placemark>
</kml>
`,
);
// KMZ — zip: локальный заголовок `PK\\x03\\x04` с doc.kml (без сжатия), формат по сигнатуре — не маршрут
const kml = new TextEncoder().encode('<kml><Document/></kml>');
const name = new TextEncoder().encode('doc.kml');
const header = new Uint8Array(30);
header.set([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0]);
const view = new DataView(header.buffer);
view.setUint32(18, kml.length, true);
view.setUint32(22, kml.length, true);
view.setUint16(26, name.length, true);
write('route.kmz', Uint8Array.from([...header, ...name, ...kml]));

write('expected.json', `${JSON.stringify(expected, null, 2)}\n`);
process.stdout.write('kml fixtures: done\n');
