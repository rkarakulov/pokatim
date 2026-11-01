import { type ReactNode, useId } from 'react';

/** Одна цифра строки: подпись, значение и необязательная подпись под ним (скорость для «В пути»). */
export type RouteStat = { label: string; value: ReactNode; hint?: ReactNode };

/**
 * Цифры маршрута строкой (admin-route-stats-compact; как строка статистики komoot/Strava): подпись мелко, значение
 * средним кеглем, без плиток — между картой и профилем. Каждая цифра — `role="group"` с подписью-именем (как у
 * `StatTile`: тесты и скринридер читают «Длина — 86,0 км»). Узкое окно — перенос в несколько строк.
 */
export function RouteStats({ items }: { items: readonly RouteStat[] }) {
  const id = useId();
  return (
    <div className="route-stats">
      {items.map((item, index) => (
        <div
          key={item.label}
          className="route-stats__item"
          role="group"
          aria-labelledby={`${id}-${index}`}
        >
          <span id={`${id}-${index}`} className="route-stats__label t-meta-xs">
            {item.label}
          </span>
          <span className="route-stats__value t-title-sm">{item.value}</span>
          {item.hint ? <span className="route-stats__hint t-meta-xs">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
