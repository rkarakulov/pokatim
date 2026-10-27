import type { CatalogRouteElevation } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import {
  fractionAt,
  PROFILE_FILL_OPACITY,
  PROFILE_VIEW_BOX,
  profilePaths,
  SCRUB_MARKER_ATTR,
  scrubKeyTarget,
  type ScrubStore,
} from '@pokatim/route-view';
import {
  type KeyboardEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from 'react';
import { useStore } from 'zustand';

import { profileTickLabels, scrubText } from './route-detail-format';

/** id градиента — постоянный: на странице один профиль. */
const GRADIENT_ID = 'route-profile-fill';

/** Площадь профиля: линия по точкам и заливка-градиент под ней; цвет — `--color-map-corridor` (CSS). */
const ProfileArea = memo(function ProfileArea({ elevation }: { elevation: CatalogRouteElevation }) {
  const paths = profilePaths(elevation);
  if (!paths) return null;
  return (
    <svg
      className="elevation-profile__svg"
      viewBox={PROFILE_VIEW_BOX}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          <stop className="elevation-profile__stop" offset="0" stopOpacity={PROFILE_FILL_OPACITY} />
          <stop className="elevation-profile__stop" offset="1" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${GRADIENT_ID})`} stroke="none" />
      <path className="elevation-profile__line" d={paths.line} />
    </svg>
  );
});

/**
 * Профиль высоты страницы маршрута панели (routes-05, A3; по образцу web приложения routes-04): inline SVG,
 * `role="slider"` — ←/↓ и →/↑ ±1 км, Home/End — старт и финиш (`scrubKeyTarget`); мышь — hover ведёт курсор, уход —
 * скрыть; касание — ведёт после `pointerdown`; касание вне профиля и маркера карты (`SCRUB_MARKER_ATTR`) — скрыть.
 * Над графиком — карточка «км · м · уклон % · набор»; доля — общий стор с маркером карты.
 */
export function ElevationProfile({
  elevation,
  distanceM,
  gainM,
  scrub,
  label,
}: {
  elevation: CatalogRouteElevation;
  distanceM: number;
  gainM: number | null;
  scrub: ScrubStore;
  /** текстовая альтернатива: «Профиль высоты: от … до … м, набор … м» */
  label: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  const fraction = useStore(scrub, (state) => state.fraction);
  const active = useStore(scrub, (state) => state.active);
  const text = scrubText(elevation, distanceM, gainM, fraction);

  useEffect(() => {
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
    scrub.setState({ fraction: fractionAt(event.clientX, rect.left, rect.width), active: true });
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
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    release();
    if (event.pointerType !== 'mouse') scrub.setState({ active: false });
  };
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && scrub.getState().dragging === null) {
      scrub.setState({ active: false });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = scrubKeyTarget(event.key, fraction, distanceM);
    if (next === null) return;
    event.preventDefault();
    scrub.setState({ fraction: next, active: true });
  };

  return (
    <div className="elevation-profile">
      <p className="elevation-profile__readout t-meta" data-testid="elevation-profile-readout">
        {active ? text.readout : t('admin.routes.detail.scrubHint')}
      </p>
      <div
        ref={node}
        className="elevation-profile__plot"
        data-testid="elevation-profile-chart"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(distanceM / 100) / 10}
        aria-valuenow={text.km}
        aria-valuetext={text.valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
      >
        <ProfileArea elevation={elevation} />
        {active ? (
          <span
            className="elevation-profile__cursor"
            data-testid="elevation-profile-cursor"
            aria-hidden="true"
            // позиция курсора — данные (доля), не оформление
            style={{ left: `${fraction * 100}%` }}
          />
        ) : null}
      </div>
      <div className="elevation-profile__axis t-meta" aria-hidden="true">
        {profileTickLabels(distanceM).map((tick) => (
          <span
            key={tick.label}
            className="elevation-profile__tick"
            style={{ left: `${tick.position * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
