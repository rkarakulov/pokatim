import { create } from 'qrcode';
import { useMemo } from 'react';

/** Тихая зона вокруг символа (модулей) — по стандарту QR. */
const QUIET_ZONE = 4;

/**
 * QR-код своим `<svg>` из матрицы `qrcode.create` (без `data:` URL и `innerHTML` — CSP панели): один `<path>` из
 * квадратов модулей, белая подложка с тихой зоной. Картинка с подписью (`role="img"`); текст кода показывает
 * вызывающий рядом — для ручного ввода и экранного чтения. Кандидат в `admin-kit` (F6).
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    const parts: string[] = [];
    for (let row = 0; row < modules.size; row += 1) {
      for (let col = 0; col < modules.size; col += 1) {
        if (modules.data[row * modules.size + col]) {
          parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
        }
      }
    }
    return { size: modules.size + QUIET_ZONE * 2, path: parts.join('') };
  }, [value]);
  return (
    <svg
      className="qr-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect className="qr-code__background" width={size} height={size} />
      <path className="qr-code__modules" d={path} />
    </svg>
  );
}
