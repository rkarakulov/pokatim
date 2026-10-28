import type { AppTheme } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import type { CSSProperties } from 'react';

import { DecorSvg } from './decor-svg';
import { BAT, COBWEB, halloweenColors, MOON, PUMPKIN, SPIDER, WITCH } from './halloween-art';
import { HALLOWEEN_LAYOUT as L, HALLOWEEN_MOTION as M } from './halloween-layout';

const FLY_SHARE = Math.round((M.flyMs / (M.flyMs + M.flyPauseMs)) * 100);

const FLY_END = -L.witch.width * 1.5;

/**
 * Анимации — CSS и только `transform` (без пересчёта раскладки): паук покачивается, дорожка ведьмы (во всю ширину)
 * едет справа налево за левый край и ждёт. Reduce motion — `prefers-reduced-motion`: анимаций нет, вместо пролёта —
 * ведьма у луны внизу слева.
 */
const CSS = `
@keyframes pokatim-decor-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(${L.spider.bob}px); } }
@keyframes pokatim-decor-fly {
  0% { transform: translateX(100%); }
  ${FLY_SHARE}%, 100% { transform: translateX(${FLY_END}px); }
}
.pokatim-decor-bob { animation: pokatim-decor-bob ${M.bobMs * 2}ms ease-in-out infinite; }
.pokatim-decor-fly { animation: pokatim-decor-fly ${M.flyMs + M.flyPauseMs}ms linear infinite; }
.pokatim-decor-still { display: none; }
@media (prefers-reduced-motion: reduce) {
  .pokatim-decor-bob { animation: none; }
  .pokatim-decor-fly { display: none; }
  .pokatim-decor-still { display: block; }
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
          bottom: L.moon.bottom,
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
            bottom: bat.bottom,
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
        data-testid="halloween-witch-still"
        className="pokatim-decor-still"
        style={box({
          bottom: L.witch.bottom,
          left: L.witch.left,
          width: L.witch.width,
          height: L.witch.height,
          opacity: L.witch.opacity,
        })}
      >
        <DecorSvg art={WITCH} colors={colors} />
      </div>
      <div
        data-testid="halloween-witch"
        className="pokatim-decor-fly"
        style={box({
          top: L.witch.flyTop,
          left: 0,
          right: 0,
          height: L.witch.height,
          opacity: L.witch.opacity,
        })}
      >
        <div style={box({ top: 0, left: 0, width: L.witch.width, height: L.witch.height })}>
          <DecorSvg art={WITCH} colors={colors} />
        </div>
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
