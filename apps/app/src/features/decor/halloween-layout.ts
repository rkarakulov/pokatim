/**
 * Раскладка хеллоуинского декора (halloween-decor), общая для native и web: элементы — у краёв области ленты,
 * полупрозрачные и мелкие, чтобы не мешать чтению. Верх слева — кикер и заголовок первого раздела: там только
 * пролёт ведьмы; луна, мыши и ведьма без анимации — внизу слева, зеркально тыквам.
 */
export const HALLOWEEN_LAYOUT = {
  cobweb: { size: 112, opacity: 0.4 },
  /** паук висит на нити от края области (нить уходит за верх) */
  spider: { size: 22, right: 38, threadTop: -40, thread: 96, opacity: 0.85, bob: 14 },
  moon: { size: 32, bottom: 18, left: 14, opacity: 0.35 },
  bats: [
    { size: 20, bottom: 58, left: 58, opacity: 0.5 },
    { size: 14, bottom: 44, left: 90, opacity: 0.45 },
  ],
  /** без анимации ведьма стоит на фоне луны; с анимацией — пролетает над лентой справа налево */
  witch: { width: 64, height: 48, bottom: 6, left: 4, flyTop: 56, opacity: 0.55 },
  pumpkins: [
    { size: 44, right: 12, bottom: 10, opacity: 0.8 },
    { size: 30, right: 56, bottom: 10, opacity: 0.75 },
  ],
} as const;

/** Темп анимаций (мс): покачивание паука — полупериод; ведьма — пролёт и пауза до следующего. */
export const HALLOWEEN_MOTION = { bobMs: 1600, flyMs: 9000, flyPauseMs: 12000 } as const;
