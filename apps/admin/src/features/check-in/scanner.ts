import { TicketQrPayload } from '@pokatim/contracts';

/** Распознавание QR в кадре: содержимое или `null`. */
export type Decoder = (frame: ImageData) => Promise<string | null>;

/** Кадр распознавания — не больше 640 px по большей стороне (слабые телефоны, ~5 кадров/с). */
export const SCAN_FRAME_MAX = 640;
/** Пауза между кадрами распознавания, мс (~5 кадров/с). */
export const SCAN_INTERVAL_MS = 200;
/** Тот же QR в течение 5 с — без повторного запроса. */
export const SCAN_DEDUP_MS = 5_000;

interface DetectorClass {
  getSupportedFormats(): Promise<string[]>;
  new (options: { formats: string[] }): {
    detect(source: ImageData): Promise<{ rawValue: string }[]>;
  };
}

/**
 * Декодер QR: нативный `BarcodeDetector` с `qr_code`, иначе `jsqr` (MIT, без eval) — динамическим импортом, отдельный
 * чанк сборки (`script-src 'self'`).
 */
export async function createDecoder(
  env: { BarcodeDetector?: unknown } = globalThis as { BarcodeDetector?: unknown },
): Promise<Decoder> {
  const Detector = env.BarcodeDetector as DetectorClass | undefined;
  const formats: string[] = Detector ? await Detector.getSupportedFormats().catch(() => []) : [];
  if (Detector && formats.includes('qr_code')) {
    const detector = new Detector({ formats: ['qr_code'] });
    return async (frame) => (await detector.detect(frame))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  return async (frame) =>
    jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** Содержимое скана: QR билета «Покатим» (`PKT1.<token>`) или чужой код (без запроса к серверу). */
export function parseScan(raw: string): { kind: 'ticket'; qr: string } | { kind: 'foreign' } {
  const parsed = TicketQrPayload.safeParse(raw.trim());
  return parsed.success ? { kind: 'ticket', qr: parsed.data } : { kind: 'foreign' };
}

/** Фильтр повторов: `true` — новый скан, `false` — тот же payload в окне `windowMs`. */
export function createDedup(windowMs = SCAN_DEDUP_MS, now: () => number = Date.now) {
  let last: { payload: string; at: number } | null = null;
  return (payload: string): boolean => {
    const at = now();
    const repeat = last !== null && last.payload === payload && at - last.at < windowMs;
    if (!repeat) last = { payload, at };
    return !repeat;
  };
}

/** Размер кадра распознавания с сохранением пропорций. */
export function scaledSize(width: number, height: number, max = SCAN_FRAME_MAX) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
