/// <reference types="jest" />
import { create } from 'qrcode';

import { QR_QUIET_ZONE, qrMatrix } from './qr-matrix';

const PAYLOAD = `PKT1.${'aB3_-'.repeat(8)}xyz`;

/** Тёмные модули из `path` (`M x y h n v1 h-n z`) — координаты с отступом quiet zone. */
function darkFromPath(path: string): Set<string> {
  const dark = new Set<string>();
  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i += 1) dark.add(`${Number(x) + i},${y}`);
  }
  return dark;
}

describe('qrMatrix — матрица QR → path (RC-B5)', () => {
  it('QR билета `PKT1.` + 43 — версия 4 (33 модуля) + quiet zone 4 с каждой стороны', () => {
    expect(QR_QUIET_ZONE).toBe(4);
    expect(qrMatrix(PAYLOAD).size).toBe(33 + 2 * 4);
  });

  it('детерминированный: тот же payload — тот же path (SSR = гидрация)', () => {
    expect(qrMatrix(PAYLOAD).path).toBe(qrMatrix(PAYLOAD).path);
    expect(qrMatrix(PAYLOAD).path).not.toBe(qrMatrix(`${PAYLOAD.slice(0, -1)}Q`).path);
  });

  it('тёмные модули совпадают с `qrcode` (уровень коррекции M), отступ — quiet zone', () => {
    const reference = create(PAYLOAD, { errorCorrectionLevel: 'M' }).modules;
    const expected = new Set<string>();
    for (let row = 0; row < reference.size; row += 1) {
      for (let col = 0; col < reference.size; col += 1) {
        if (reference.get(row, col)) expected.add(`${col + 4},${row + 4}`);
      }
    }
    expect(darkFromPath(qrMatrix(PAYLOAD).path)).toEqual(expected);
  });

  it('путь — только прямоугольники строк модулей: без чисел вне сетки', () => {
    const { path, size } = qrMatrix(PAYLOAD);
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    for (const cell of darkFromPath(path)) {
      const [x, y] = cell.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeLessThan(size - 4);
    }
  });
});
