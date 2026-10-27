import { describe, expect, it } from 'vitest';

import { gpxContentDisposition, gpxFileName, ROUTE_POLICY } from './routes.policy';

describe('gpxFileName (routes-03, RC-14)', () => {
  it('кириллица и пробелы: схлопываются, края обрезаются', () => {
    expect(gpxFileName('  Минское   кольцо  ')).toBe('Минское кольцо');
  });

  it('управляющие символы, \\/:*?"<>| и bidi U+202E удаляются', () => {
    expect(gpxFileName('a\u0000b\u0007c\td')).toBe('abcd');
    expect(gpxFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(gpxFileName('route‮xpg.exe')).toBe('routexpg.exe');
    expect(gpxFileName('a​b')).toBe('ab');
  });

  it('точки и пробелы по краям обрезаются', () => {
    expect(gpxFileName('..Круг..')).toBe('Круг');
    expect(gpxFileName(' . ')).toBe('pokatim-route');
  });

  it('пусто — pokatim-route', () => {
    expect(gpxFileName('')).toBe('pokatim-route');
    expect(gpxFileName('<>|‮')).toBe('pokatim-route');
  });

  it('≤ 80 кодовых точек; эмодзи не режется пополам', () => {
    expect(Array.from(gpxFileName('я'.repeat(100)))).toHaveLength(80);
    const name = gpxFileName(`${'a'.repeat(79)}🚴🚴`);
    expect(name).toBe(`${'a'.repeat(79)}🚴`);
    expect(Array.from(name)).toHaveLength(80);
  });
});

describe('gpxContentDisposition (routes-03)', () => {
  it("attachment, ASCII-fallback и filename* по RFC 5987 (экранированы '(); * удалён из имени)", () => {
    expect(gpxContentDisposition("Круг (Минск) 'x*'")).toBe(
      `attachment; filename="pokatim-route.gpx"; filename*=UTF-8''${encodeURIComponent('Круг ')}%28${encodeURIComponent('Минск')}%29%20%27x%27.gpx`,
    );
    expect(gpxContentDisposition('')).toBe(
      `attachment; filename="pokatim-route.gpx"; filename*=UTF-8''pokatim-route.gpx`,
    );
  });

  it('лимиты: GPX 30 в минуту с IP, пачка бэкфилла 20', () => {
    expect(ROUTE_POLICY.gpxIpLimit).toEqual({ limit: 30, windowSec: 60 });
    expect(ROUTE_POLICY.deriveBatch).toBe(20);
  });
});
