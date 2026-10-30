import { describe, expect, it } from 'vitest';

import {
  canPublish,
  type PublicationAction,
  publicationTransition,
  ROUTE_EXPORT_CONTENT_TYPES,
  ROUTE_POLICY,
  routeContentDisposition,
  routeExportFormats,
  routeFileName,
} from './routes.policy';
import type { RoutePublicationDoc } from './routes.collection';

describe('routeFileName (routes-03, RC-14; routes-formats — общее для форматов)', () => {
  it('кириллица и пробелы: схлопываются, края обрезаются', () => {
    expect(routeFileName('  Минское   кольцо  ')).toBe('Минское кольцо');
  });

  it('управляющие символы, \\/:*?"<>| и bidi U+202E удаляются', () => {
    expect(routeFileName('a\u0000b\u0007c\td')).toBe('abcd');
    expect(routeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(routeFileName('route‮xpg.exe')).toBe('routexpg.exe');
    expect(routeFileName('a​b')).toBe('ab');
  });

  it('точки и пробелы по краям обрезаются', () => {
    expect(routeFileName('..Круг..')).toBe('Круг');
    expect(routeFileName(' . ')).toBe('pokatim-route');
  });

  it('пусто — pokatim-route', () => {
    expect(routeFileName('')).toBe('pokatim-route');
    expect(routeFileName('<>|‮')).toBe('pokatim-route');
  });

  it('≤ 80 кодовых точек; эмодзи не режется пополам', () => {
    expect(Array.from(routeFileName('я'.repeat(100)))).toHaveLength(80);
    const name = routeFileName(`${'a'.repeat(79)}🚴🚴`);
    expect(name).toBe(`${'a'.repeat(79)}🚴`);
    expect(Array.from(name)).toHaveLength(80);
  });
});

describe('routeContentDisposition (routes-03; routes-formats)', () => {
  it("attachment, ASCII-fallback и filename* по RFC 5987 (экранированы '(); * удалён из имени)", () => {
    expect(routeContentDisposition("Круг (Минск) 'x*'", 'gpx')).toBe(
      `attachment; filename="pokatim-route.gpx"; filename*=UTF-8''${encodeURIComponent('Круг ')}%28${encodeURIComponent('Минск')}%29%20%27x%27.gpx`,
    );
    expect(routeContentDisposition('', 'gpx')).toBe(
      `attachment; filename="pokatim-route.gpx"; filename*=UTF-8''pokatim-route.gpx`,
    );
  });

  it.each(['gpx', 'kml', 'tcx'] as const)('расширение %s — в fallback и в имени', (format) => {
    expect(routeContentDisposition('Кольцо‮', format)).toBe(
      `attachment; filename="pokatim-route.${format}"; filename*=UTF-8''${encodeURIComponent('Кольцо')}.${format}`,
    );
  });

  it('MIME форматов — с charset=utf-8', () => {
    expect(ROUTE_EXPORT_CONTENT_TYPES).toEqual({
      gpx: 'application/gpx+xml; charset=utf-8',
      kml: 'application/vnd.google-earth.kml+xml; charset=utf-8',
      tcx: 'application/vnd.garmin.tcx+xml; charset=utf-8',
    });
  });

  it('лимиты: скачиваний 30 в минуту с IP (один бюджет на форматы), пачка бэкфилла 20', () => {
    expect(ROUTE_POLICY.exportIpLimit).toEqual({ limit: 30, windowSec: 60 });
    expect(ROUTE_POLICY.deriveBatch).toBe(20);
  });
});

describe('routeExportFormats (routes-formats, RC-2): форматы экспорта по версии производных', () => {
  it('нет версии — нет экспорта; 1 — GPX; ≥ 2 — GPX, KML, TCX', () => {
    expect(routeExportFormats(null)).toEqual([]);
    expect(routeExportFormats(1)).toEqual(['gpx']);
    expect(routeExportFormats(2)).toEqual(['gpx', 'kml', 'tcx']);
    expect(routeExportFormats(3)).toEqual(['gpx', 'kml', 'tcx']);
  });
});

describe('publicationTransition (routes-06, A1): все пары статус × действие', () => {
  type From = RoutePublicationDoc['status'] | null;
  const STATES: From[] = [null, 'pending', 'approved', 'rejected', 'hidden', 'withdrawn'];
  const ok = (to: RoutePublicationDoc['status']) => ({ result: 'ok', to });
  const noop = { result: 'noop' };
  const invalid = (reason: string | null) => ({ result: 'invalid', reason });
  /** Ожидание по строкам STATES. */
  const TABLE: Record<PublicationAction, unknown[]> = {
    submit: [
      ok('pending'),
      invalid('in_review'),
      invalid('published'),
      ok('pending'),
      invalid('hidden'),
      ok('pending'),
    ],
    withdraw: [noop, ok('withdrawn'), ok('withdrawn'), noop, invalid('hidden'), noop],
    approve: [
      invalid(null),
      ok('approved'),
      invalid('published'),
      invalid(null),
      invalid('hidden'),
      invalid(null),
    ],
    reject: [
      invalid(null),
      ok('rejected'),
      invalid('published'),
      invalid(null),
      invalid('hidden'),
      invalid(null),
    ],
    hide: [
      invalid(null),
      invalid('in_review'),
      ok('hidden'),
      invalid(null),
      invalid('hidden'),
      invalid(null),
    ],
    restore: [
      invalid(null),
      invalid('in_review'),
      invalid('published'),
      invalid(null),
      ok('approved'),
      invalid(null),
    ],
    dismiss: [
      invalid(null),
      invalid('in_review'),
      ok('approved'),
      invalid(null),
      invalid('hidden'),
      invalid(null),
    ],
  };

  for (const [action, expected] of Object.entries(TABLE) as [PublicationAction, unknown[]][]) {
    it(action, () => {
      expect(STATES.map((from) => publicationTransition(from, action))).toEqual(expected);
    });
  }
});

describe('canPublish (routes-06)', () => {
  const base = { status: 'ready' as const, publication: null };
  const pub = (status: RoutePublicationDoc['status'], submissionCount = 1) => ({
    status: 'ready' as const,
    publication: { status, submissionCount },
  });

  it('готовый без заявки, отозванный, отклонённый — можно, пока подач < 3', () => {
    expect(canPublish(base)).toBe(true);
    expect(canPublish(pub('withdrawn'))).toBe(true);
    expect(canPublish(pub('rejected', 2))).toBe(true);
    expect(canPublish(pub('rejected', 3))).toBe(false);
    expect(canPublish(pub('withdrawn', 3))).toBe(false);
  });

  it('не готовый, на проверке, опубликованный, скрытый — нельзя', () => {
    expect(canPublish({ status: 'processing', publication: null })).toBe(false);
    expect(canPublish({ status: 'failed', publication: null })).toBe(false);
    for (const status of ['pending', 'approved', 'hidden'] as const) {
      expect(canPublish(pub(status)), status).toBe(false);
    }
  });

  it('лимиты U8 в политике', () => {
    expect(ROUTE_POLICY.publicationSubmitLimit).toEqual({ limit: 10, windowSec: 86_400 });
    expect(ROUTE_POLICY.reportLimit).toEqual({ limit: 20, windowSec: 86_400 });
    expect(ROUTE_POLICY.maxPendingPublications).toBe(3);
    expect(ROUTE_POLICY.maxSubmissionsPerRoute).toBe(3);
  });
});
