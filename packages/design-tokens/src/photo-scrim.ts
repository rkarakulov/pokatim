/**
 * Затемнение фото под текстом (ride-photo, ADR-0028): вертикальный градиент цвета `overlay.scrim` темы с прозрачностью по
 * высоте кадра (0 — верх, 1 — низ). Зоны текста — мастхед сверху и нижний блок карточки-приглашения 4a (герой ленты и
 * Главной — PR B, тот же токен); середина — светлее, фото видно. Текст на фото — роль `text.onPhoto`; контраст к скриму
 * поверх **белого** фото в зонах текста — не ниже WCAG 4.5:1 (тест `photo-scrim.test.ts`). Значения — `[ASSUMPTION]`
 * до сверки с прототипом (`key-rides.html`, `key-home.html`). Изменил — подними `renderVersion` карточек в API.
 */
export interface PhotoScrimProfile {
  /** остановки прозрачности по высоте кадра (0 — верх, 1 — низ), по возрастанию `at` */
  readonly stops: readonly { readonly at: number; readonly alpha: number }[];
  /** доли высоты, где лежит текст: контраст `onPhoto` ≥ 4.5:1 поверх белого фото (тест) */
  readonly textZones: readonly { readonly from: number; readonly to: number }[];
}

export const photoScrim = {
  stops: [
    { at: 0, alpha: 0.62 },
    { at: 0.1, alpha: 0.58 },
    { at: 0.2, alpha: 0.25 },
    { at: 0.3, alpha: 0.58 },
    { at: 1, alpha: 0.85 },
  ],
  /** доли высоты кадра, где лежит текст (4a: мастхед; нижний блок с названием в три строки, плиткой линии и парой) */
  textZones: [
    { from: 0, to: 0.08 },
    { from: 0.33, to: 1 },
  ],
} as const satisfies PhotoScrimProfile;

/**
 * Затемнение героя ленты «Кофе-райды» и Главной с фото организатора (ride-photo PR B): блок от `size.heroHeight` растёт
 * от переносов названия и крупного шрифта, и кикер может оказаться у самого верха — поэтому зона текста — вся высота:
 * прозрачность нигде не ниже порога контраста `onPhoto` 4.5:1 поверх белого фото, к низу — сильнее (название и линия).
 * Значения — `[ASSUMPTION]` до сверки с прототипом (`key-rides.html`, `key-home.html`).
 */
export const photoScrimHero = {
  stops: [
    { at: 0, alpha: 0.58 },
    { at: 0.5, alpha: 0.64 },
    { at: 1, alpha: 0.82 },
  ],
  textZones: [{ from: 0, to: 1 }],
} as const satisfies PhotoScrimProfile;

/** Прозрачность скрима на высоте `at` (доля кадра 0…1): линейно между остановками профиля (по умолчанию — 4a). */
export function photoScrimAlpha(at: number, profile: PhotoScrimProfile = photoScrim): number {
  const { stops } = profile;
  const clamped = Math.min(Math.max(at, 0), 1);
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (prev && next && clamped <= next.at) {
      return prev.alpha + ((next.alpha - prev.alpha) * (clamped - prev.at)) / (next.at - prev.at);
    }
  }
  return stops[stops.length - 1]?.alpha ?? 0;
}
