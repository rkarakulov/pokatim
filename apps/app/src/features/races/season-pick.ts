import type { SeasonCard } from '@pokatim/contracts';

/**
 * Какой сезон открыть из вкладки «Гонки» (R10, Q3): текущий → ближайший предстоящий → последний завершённый; сезонов
 * нет — `null` (кнопки нет). Фазы — с сервера; клиент только выбирает по ним (представление, §4.1 не затронут).
 * `all` — `GET /v1/seasons`, новые сверху.
 */
export function pickSeason(
  current: SeasonCard | null,
  all: readonly SeasonCard[],
): SeasonCard | null {
  if (current) return current;
  const upcoming = all.filter((season) => season.phase === 'upcoming');
  // новые сверху: ближайший предстоящий — последний из предстоящих
  const nearest = upcoming.at(-1);
  if (nearest) return nearest;
  return all.find((season) => season.phase === 'finished') ?? null;
}
