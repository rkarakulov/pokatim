/**
 * Раскладка хеллоуинского декора (halloween-decor), общая для native и web: элементы — у краёв области ленты,
 * полупрозрачные и мелкие, чтобы не мешать чтению; центр экрана свободен.
 */
export const HALLOWEEN_LAYOUT = {
  cobweb: { size: 112, opacity: 0.4 },
  /** паук висит на нити от края области (нить уходит за верх) */
  spider: { size: 22, right: 38, threadTop: -40, thread: 96, opacity: 0.85, bob: 14 },
  moon: { size: 36, top: 10, left: 12, opacity: 0.35 },
  bats: [
    { size: 20, top: 46, left: 60, opacity: 0.5 },
    { size: 14, top: 26, left: 92, opacity: 0.45 },
  ],
  /** без анимации ведьма стоит на фоне луны; с анимацией — пролетает над лентой справа налево */
  witch: { width: 64, height: 48, top: 4, left: 2, flyTop: 56, opacity: 0.55 },
  pumpkins: [
    { size: 44, right: 12, bottom: 10, opacity: 0.8 },
    { size: 30, right: 56, bottom: 10, opacity: 0.75 },
  ],
} as const;

/** Темп анимаций (мс): покачивание паука — полупериод; ведьма — пролёт и пауза до следующего. */
export const HALLOWEEN_MOTION = { bobMs: 1600, flyMs: 9000, flyPauseMs: 12000 } as const;
