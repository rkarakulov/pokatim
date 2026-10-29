import { describe, expect, it, vi } from 'vitest';

import { createDecoder, createDedup, parseScan, scaledSize } from './scanner';

const QR = `PKT1.${'a'.repeat(43)}`;
const frame = { data: new Uint8ClampedArray(16), width: 2, height: 2 } as ImageData;

vi.mock('jsqr', () => ({ default: vi.fn(() => ({ data: 'from-jsqr' })) }));

describe('scanner (check-in, event-tickets PR C)', () => {
  it('parseScan — только PKT1-содержимое билета, иначе «не билет» без запроса', () => {
    expect(parseScan(` ${QR}\n`)).toEqual({ kind: 'ticket', qr: QR });
    expect(parseScan('https://example.com')).toEqual({ kind: 'foreign' });
    expect(parseScan(`PKT2.${'a'.repeat(43)}`)).toEqual({ kind: 'foreign' });
    expect(parseScan(`${QR}x`)).toEqual({ kind: 'foreign' });
  });

  it('дедупликация: тот же payload в течение 5 с — повтор; другой — новый; через 5 с — снова новый', () => {
    let now = 1_000;
    const isNew = createDedup(5_000, () => now);
    expect(isNew(QR)).toBe(true);
    now += 4_999;
    expect(isNew(QR)).toBe(false);
    expect(isNew('other')).toBe(true);
    expect(isNew(QR)).toBe(true);
    now += 5_000;
    expect(isNew(QR)).toBe(true);
  });

  it('кадр уменьшается до ≤ 640 px по большей стороне с сохранением пропорций', () => {
    expect(scaledSize(1920, 1080)).toEqual({ width: 640, height: 360 });
    expect(scaledSize(480, 640)).toEqual({ width: 480, height: 640 });
    expect(scaledSize(1080, 1920)).toEqual({ width: 360, height: 640 });
  });

  it('нативный BarcodeDetector с qr_code — первым; без него — jsqr', async () => {
    const detect = vi.fn(async () => [{ rawValue: QR }]);
    class Detector {
      static getSupportedFormats = vi.fn(async () => ['ean_13', 'qr_code']);
      detect = detect;
    }
    const native = await createDecoder({ BarcodeDetector: Detector });
    expect(await native(frame)).toBe(QR);
    expect(detect).toHaveBeenCalledWith(frame);

    class NoQr {
      static getSupportedFormats = vi.fn(async () => ['ean_13']);
      detect = vi.fn();
    }
    const fallback = await createDecoder({ BarcodeDetector: NoQr });
    expect(await fallback(frame)).toBe('from-jsqr');
    expect(await (await createDecoder({}))(frame)).toBe('from-jsqr');
  });
});
