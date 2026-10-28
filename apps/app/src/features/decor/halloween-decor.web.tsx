import type { AppTheme } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import type { CSSProperties } from 'react';

import { DecorSvg } from './decor-svg';
import { BAT, COBWEB, halloweenColors, MOON, PUMPKIN, SPIDER, WITCH } from './halloween-art';
import { HALLOWEEN_LAYOUT as L, HALLOWEEN_MOTION as M } from './halloween-layout';

const FLY_SHARE = Math.round((M.flyMs / (M.flyMs + M.flyPauseMs)) * 100);

/**
 * Анимации — CSS: паук покачивается, ведьма пролетает справа налево (`left` от правого края за левый) и ждёт. Reduce
 * motion — `prefers-reduced-motion`: анимаций нет, ведьма стоит у луны (базовый `left`/`top`).
 */
const CSS = `
@keyframes pokatim-decor-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(${L.spider.bob}px); } }
@keyframes pokatim-decor-fly {
  0% { left: 100%; top: ${L.witch.flyTop}px; }
  ${FLY_SHARE}% { left: -${L.witch.width * 1.5}px; top: ${L.witch.flyTop}px; }
  100% { left: -${L.witch.width * 1.5}px; top: ${L.witch.flyTop}px; }
}
.pokatim-decor-bob { animation: pokatim-decor-bob ${M.bobMs * 2}ms ease-in-out infinite; }
.pokatim-decor-fly { animation: pokatim-decor-fly ${M.flyMs + M.flyPauseMs}ms linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .pokatim-decor-bob, .pokatim-decor-fly { animation: none; }
}
`;

const box = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });

/**
 * Хеллоуинский декор на web (halloween-decor): тот же слой, что native, — DOM и inline SVG. Касания не перехватывает
 * (`pointer-events: none`), скрыт от скринридеров (`aria-hidden`). Монтируется только после гидрации (`DecorLayer`).
 */
export function HalloweenDecor() {
  const colors = halloweenColors(useTheme<AppTheme>());
  return (
    <div
      data-testid="halloween-decor"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <style>{CSS}</style>
      <div
        style={box({
          top: 0,
          right: 0,
          width: L.cobweb.size,
          height: L.cobweb.size,
          opacity: L.cobweb.opacity,
        })}
      >
        <DecorSvg art={COBWEB} colors={colors} />
      </div>
      <div
        data-testid="halloween-spider"
        className="pokatim-decor-bob"
        style={box({
          top: L.spider.threadTop,
          right: L.spider.right,
          width: L.spider.size,
          height: L.spider.thread + L.spider.size,
          opacity: L.spider.opacity,
        })}
      >
        <div
          style={box({
            top: 0,
            left: L.spider.size / 2,
            width: 1,
            height: L.spider.thread,
            background: colors.ink,
          })}
        />
        <div
          style={box({
            top: L.spider.thread,
            left: 0,
            width: L.spider.size,
            height: L.spider.size,
          })}
        >
          <DecorSvg art={SPIDER} colors={colors} />
        </div>
      </div>
      <div
        style={box({
          top: L.moon.top,
          left: L.moon.left,
          width: L.moon.size,
          height: L.moon.size,
          opacity: L.moon.opacity,
        })}
      >
        <DecorSvg art={MOON} colors={colors} />
      </div>
      {L.bats.map((bat, index) => (
        <div
          key={index}
          style={box({
            top: bat.top,
            left: bat.left,
            width: bat.size,
            height: bat.size / 2,
            opacity: bat.opacity,
          })}
        >
          <DecorSvg art={BAT} colors={colors} />
        </div>
      ))}
      <div
        data-testid="halloween-witch"
        className="pokatim-decor-fly"
        style={box({
          top: L.witch.top,
          left: L.witch.left,
          width: L.witch.width,
          height: L.witch.height,
          opacity: L.witch.opacity,
        })}
      >
        <DecorSvg art={WITCH} colors={colors} />
      </div>
      {L.pumpkins.map((pumpkin, index) => (
        <div
          key={index}
          style={box({
            right: pumpkin.right,
            bottom: pumpkin.bottom,
            width: pumpkin.size,
            height: pumpkin.size * 0.9,
            opacity: pumpkin.opacity,
          })}
        >
          <DecorSvg art={PUMPKIN} colors={colors} />
        </div>
      ))}
    </div>
  );
}
