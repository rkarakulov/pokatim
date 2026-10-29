import type { LonLat } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import { OG_FIXTURES, ogFixture } from '../../../test/og-fixtures';
import type { OgCardInput } from './og-card.inputs';
import { renderOgCard } from './og-card.png';
import { OG_CARD_POLICY } from './sharing.policy';

/** Петля ≈ 1000 точек — больше лимита точек (упрощается). */
const loop: LonLat[] = Array.from({ length: 1000 }, (_, i) => {
  const a = (i / 999) * 2 * Math.PI;
  return [27.55 + 0.1 * Math.cos(a), 53.9 + 0.05 * Math.sin(a)];
});

const cases: [string, OgCardInput, LonLat[] | null][] = [
  ['гонка с линией', OG_FIXTURES.race, loop],
  ['райд без линии, длинное название', ogFixture('ride', { title: 'К'.repeat(90) }), null],
  ['маршрут с линией, тема «Ночь»', { ...OG_FIXTURES.route, themeId: 'chrono' }, loop],
  ['старт календаря', OG_FIXTURES.calendar, null],
  ['бренд', OG_FIXTURES.brand, null],
];

describe('PNG OG-картинки (реальные satori + resvg)', () => {
  it.each(cases)('%s: PNG 1200×630, ≤ maxPngBytes', async (name, input, line) => {
    const png = await renderOgCard(input, line);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.byteLength).toBeLessThanOrEqual(OG_CARD_POLICY.maxPngBytes);
    // размер для оценки памяти Redis (R-A1)
    process.stdout.write(`og png ${name}: ${png.byteLength} B\n`);
  });
});
