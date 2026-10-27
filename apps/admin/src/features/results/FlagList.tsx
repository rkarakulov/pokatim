import type { PanelAttemptFlag } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { StatusTag } from '../../ui';
import { flagMetricText } from './results-format';

/**
 * Флаги «Требует внимания» (race-results-07): подпись кода и метрика подсказкой под ней (проценты или отношение к
 * медиане группы — без пульса и мощности). Флаги не блокируют публикацию; нет флагов — «—».
 */
export function FlagList({ flags }: { flags: readonly PanelAttemptFlag[] }) {
  if (flags.length === 0) return <>{t('admin.results.flags.none')}</>;
  return (
    <ul className="flag-list">
      {flags.map((flag) => (
        <li key={flag.code} className="flag-list__item">
          <StatusTag tone="ink">{t(`admin.results.flag.${flag.code}`)}</StatusTag>
          <span className="muted t-meta">{flagMetricText(flag)}</span>
        </li>
      ))}
    </ul>
  );
}
