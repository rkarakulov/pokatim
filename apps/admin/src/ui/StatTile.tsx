import { type ReactNode, useId } from 'react';

/**
 * Плитка метрики (KPI): подпись и число. Значения ещё нет (`undefined`) — скелетон на месте числа, подпись видна
 * (AGENTS.md §4.12). Без доменных импортов; кандидат в `admin-kit` (F6).
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode | undefined;
  hint?: ReactNode;
}) {
  const id = useId();
  const loading = value === undefined;
  return (
    <div
      className="stat-tile"
      role="group"
      aria-labelledby={`${id}-label`}
      aria-busy={loading || undefined}
    >
      <p id={`${id}-label`} className="stat-tile__label t-label">
        {label}
      </p>
      <p className="stat-tile__value t-panel-kpi">
        {loading ? (
          <span className="skeleton stat-tile__skeleton" data-testid="skeleton-stat">
            {' '}
          </span>
        ) : (
          value
        )}
      </p>
      {hint ? <p className="stat-tile__hint t-meta">{hint}</p> : null}
    </div>
  );
}
