import type { ReactNode } from 'react';

/** Одиночный чип-переключатель фильтра («Мои»): кнопка `aria-pressed`, выбранный — заливка ink с галочкой. */
export function ToggleChip({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip t-body" aria-pressed={pressed} onClick={onToggle}>
      <span className="chip__check" aria-hidden="true" />
      {children}
    </button>
  );
}
