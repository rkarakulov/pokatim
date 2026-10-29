import { create } from 'qrcode/lib/core/qrcode';

/** Светлая рамка вокруг кода в модулях — по стандарту QR (без неё сканеры путают край с фоном). */
export const QR_QUIET_ZONE = 4;

/** Матрица QR для SVG: сторона `viewBox` в модулях (с рамкой) и `path` тёмных модулей. */
export interface QrMatrix {
  size: number;
  path: string;
}

/**
 * QR билета (`PKT1.<token>`) → `path` для SVG (native — `react-native-svg`, web — `<svg>`): ядро `qrcode` без
 * рендереров, уровень коррекции M. Подряд идущие тёмные модули строки — один прямоугольник `M x y h n v1 h-n z`.
 * Чистая функция: тот же payload — тот же путь (SSR = гидрация, без `useId`).
 */
export function qrMatrix(payload: string): QrMatrix {
  const { modules } = create(payload, { errorCorrectionLevel: 'M' });
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col += 1;
      const run = col - start;
      parts.push(`M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${run}v1h-${run}z`);
    }
  }
  return { size: modules.size + 2 * QR_QUIET_ZONE, path: parts.join('') };
}
