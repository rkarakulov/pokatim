import { t } from '@pokatim/i18n';

import { useAppTheme } from '@/theme/use-app-theme';

import { qrMatrix } from './qr-matrix';
import type { TicketQrProps } from './ticket-qr-props';

/**
 * QR билета на web (RC-B5): inline `<svg>` — разметка зависит только от payload (SSR = первый рендер),
 * `react-native-svg` в web-бандл не попадает. Тёмные модули `ticket.qrInk` на «бумаге» `ticket.qrPaper`.
 */
export function TicketQr({ payload, size }: TicketQrProps) {
  const { colors } = useAppTheme();
  const matrix = qrMatrix(payload);
  return (
    <svg
      data-testid="ticket-qr"
      role="img"
      aria-label={t('tickets.qrLabel')}
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: 'block', alignSelf: 'center', background: colors.ticket.qrPaper }}
    >
      <rect width={matrix.size} height={matrix.size} fill={colors.ticket.qrPaper} />
      <path d={matrix.path} fill={colors.ticket.qrInk} />
    </svg>
  );
}
