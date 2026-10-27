import type { CatalogRouteElevation } from '@pokatim/contracts';
import { stroke, type AppTheme } from '@pokatim/design-tokens';
import {
  memo,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { SCRUB_MARKER_ATTR, useScrub, type ScrubStore } from '@/features/maps/scrub-store';

import type { ProfileChartProps } from './profile-chart-props';
import { PROFILE_VIEW_BOX, profileGradientId, profilePaths } from './profile-path';
import { PROFILE_ASPECT_RATIO, PROFILE_FILL_OPACITY } from './profile-style';
import { scrubReadout, scrubStep } from './scrub';

/**
 * Площадь профиля на web (routes-03 fix + routes-04 G1): inline SVG — плавная линия по всем точкам профиля в
 * приглушённом `map.corridor` толщиной `stroke.input` и заливка-градиент под ней (у линии `PROFILE_FILL_OPACITY`, внизу
 * прозрачно). Inline, а не `react-native-svg`: разметка зависит только от данных — SSR и первый клиентский рендер
 * совпадают, пакет в web-бандл не попадает. Для скринридера скрыт (альтернатива — у контейнера), при движении курсора
 * не перерисовывается (`memo`).
 */
export const ProfileArea = memo(function ProfileArea({
  elevation,
  theme,
}: {
  elevation: CatalogRouteElevation;
  theme: AppTheme;
}) {
  const gradient = profileGradientId(useId());
  const paths = profilePaths(elevation);
  if (!paths) return null;
  const color = theme.map.corridor;
  return (
    <svg
      data-testid="elevation-profile-svg"
      viewBox={PROFILE_VIEW_BOX}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={PROFILE_FILL_OPACITY} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${gradient})`} stroke="none" />
      <path
        d={paths.line}
        fill="none"
        stroke={color}
        strokeWidth={stroke.input}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});

const boxStyle = (theme: AppTheme) =>
  ({
    position: 'relative',
    boxSizing: 'border-box',
    width: '100%',
    aspectRatio: String(PROFILE_ASPECT_RATIO),
    borderBottom: `${stroke.hairline}px solid ${theme.border.subtle}`,
  }) as const;

/**
 * График профиля на web. Без `scrub` — изображение с текстовой альтернативой (routes-03). Со `scrub` (routes-04,
 * RC-13) — `role="slider"`: ←/↓ и →/↑ — ±1 км, Home/End — старт и финиш; мышь — hover ведёт курсор, уход мыши —
 * скрыть; касание — ведёт после `pointerdown` (вертикальная прокрутка пальцем сохраняется: `touch-action: pan-y`),
 * касание вне графика и маркера карты — скрыть. Видимый фокус — `:focus-visible` в scoped `<style>`. SSR: стор
 * стартует с доли 0 — `aria-valuenow` и текст одинаковы на сервере и клиенте; `document` — только в эффекте.
 */
export function ProfileChart(props: ProfileChartProps) {
  const { elevation, theme, label, scrub } = props;
  if (!scrub) {
    return (
      <div
        data-testid="elevation-profile-chart"
        role="img"
        aria-label={label}
        style={boxStyle(theme)}
      >
        <ProfileArea elevation={elevation} theme={theme} />
      </div>
    );
  }
  return <ScrubbableChart {...props} scrub={scrub} />;
}

const KEY_STEPS: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

function ScrubbableChart({
  elevation,
  distanceM,
  gainM,
  theme,
  label,
  scrub,
}: ProfileChartProps & { scrub: ScrubStore }) {
  const node = useRef<HTMLDivElement>(null);
  const scope = useId();
  const fraction = useScrub(scrub, (state) => state.fraction);
  const active = useScrub(scrub, (state) => state.active);

  useEffect(() => {
    // касание или клик вне графика и маркера карты — курсор скрыт
    const hide = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (node.current?.contains(target)) return;
      if (target?.closest(`[${SCRUB_MARKER_ATTR}]`)) return;
      if (scrub.getState().active) scrub.setState({ active: false });
    };
    document.addEventListener('pointerdown', hide);
    return () => document.removeEventListener('pointerdown', hide);
  }, [scrub]);

  const follow = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    scrub.setState({ fraction: next, active: true });
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') {
      const element = event.currentTarget;
      if ('setPointerCapture' in element) element.setPointerCapture(event.pointerId);
      scrub.setState({ dragging: 'profile' });
    }
    follow(event);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || scrub.getState().dragging === 'profile') follow(event);
  };
  const release = () => {
    if (scrub.getState().dragging === 'profile') scrub.setState({ dragging: null });
  };
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && scrub.getState().dragging === null) {
      scrub.setState({ active: false });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[event.key];
    const next =
      step !== undefined
        ? scrubStep(fraction, distanceM, step)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 1
            : null;
    if (next === null) return;
    event.preventDefault();
    scrub.setState({ fraction: next, active: true });
  };

  const root = `[data-scrub-profile="${scope}"]`;
  const focusCss = `${root}{outline:none}${root}:focus-visible{outline:${stroke.indicator}px solid ${theme.border.focus};outline-offset:${stroke.indicator}px}`;
  return (
    <div
      ref={node}
      data-testid="elevation-profile-chart"
      data-scrub-profile={scope}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={distanceM}
      aria-valuenow={Math.round(fraction * distanceM)}
      aria-valuetext={scrubReadout(elevation, distanceM, gainM, fraction).valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      style={{ ...boxStyle(theme), touchAction: 'pan-y', cursor: 'crosshair' }}
    >
      <style>{focusCss}</style>
      <ProfileArea elevation={elevation} theme={theme} />
      <div
        data-testid="elevation-profile-cursor"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${fraction * 100}%`,
          width: stroke.indicator,
          marginLeft: -stroke.indicator / 2,
          backgroundColor: theme.action.primary,
          pointerEvents: 'none',
          display: active ? 'block' : 'none',
        }}
      />
    </div>
  );
}
