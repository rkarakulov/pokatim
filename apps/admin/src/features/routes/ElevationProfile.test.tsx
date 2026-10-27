// @vitest-environment jsdom
import type { CatalogRouteElevation } from '@pokatim/contracts';
import { createScrubStore, SCRUB_MARKER_ATTR } from '@pokatim/route-view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ElevationProfile } from './ElevationProfile';

afterEach(cleanup);

// 0 → 1 км подъём 5 %, 1 → 2 км спуск 3 %
const elevation: CatalogRouteElevation = {
  minM: 200,
  maxM: 250,
  profile: Array.from({ length: 9 }, (_, i) => {
    const d = i * 250;
    return [d, d <= 1000 ? 200 + d * 0.05 : 250 - (d - 1000) * 0.03];
  }),
};

function renderProfile() {
  const scrub = createScrubStore();
  render(
    <ElevationProfile
      elevation={elevation}
      distanceM={2000}
      gainM={null}
      scrub={scrub}
      label="Профиль высоты: от 200 до 250 м"
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Профиль высоты: от 200 до 250 м' });
  // ширина графика в jsdom — 0: прямоугольник задан явно
  slider.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect;
  return { scrub, slider };
}

describe('ElevationProfile панели (routes-05, A3)', () => {
  it('slider: км, значение словами; ←/→ — 1 км, Home/End — старт и финиш; карточка «км · м · уклон · набор»', () => {
    const { scrub, slider } = renderProfile();
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('2');
    expect(slider.getAttribute('aria-valuetext')).toBe('0 км, высота 200 м, уклон 5 %');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(scrub.getState()).toMatchObject({ fraction: 0.5, active: true });
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
    expect(slider.getAttribute('aria-valuetext')).toBe('1 км, высота 250 м, уклон 1 %');

    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuetext')).toBe('2 км, высота 220 м, уклон −3 %');
    expect(screen.getByTestId('elevation-profile-readout').textContent).toBe(
      '2 км · 220 м · ↘ 3 % · набор 50 м',
    );
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(scrub.getState().fraction).toBe(0.5);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(scrub.getState().fraction).toBe(0);
  });

  it('мышь: hover ведёт курсор, уход — скрыть; касание вне профиля и маркера — скрыть', () => {
    const { scrub, slider } = renderProfile();
    expect(screen.queryByTestId('elevation-profile-cursor')).toBeNull();
    fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 200 });
    expect(scrub.getState()).toMatchObject({ fraction: 0.25, active: true });
    expect(screen.getByTestId('elevation-profile-cursor').style.left).toBe('25%');
    fireEvent.pointerLeave(slider, { pointerType: 'mouse' });
    expect(scrub.getState().active).toBe(false);

    fireEvent.pointerMove(slider, { pointerType: 'mouse', clientX: 300 });
    const marker = document.createElement('div');
    marker.setAttribute(SCRUB_MARKER_ATTR, '');
    document.body.append(marker);
    fireEvent.pointerDown(marker);
    expect(scrub.getState().active).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(scrub.getState().active).toBe(false);
    marker.remove();
  });

  it('касание: перетаскивание после pointerdown; маркер карты двигает курсор профиля', () => {
    const { scrub, slider } = renderProfile();
    fireEvent.pointerDown(slider, { pointerType: 'touch', clientX: 100, pointerId: 1 });
    expect(scrub.getState()).toMatchObject({ fraction: 0, dragging: 'profile', active: true });
    fireEvent.pointerMove(slider, { pointerType: 'touch', clientX: 500, pointerId: 1 });
    expect(scrub.getState().fraction).toBe(1);
    fireEvent.pointerUp(slider, { pointerType: 'touch', pointerId: 1 });
    expect(scrub.getState().dragging).toBeNull();

    act(() => scrub.setState({ fraction: 0.75, active: true, dragging: 'map' }));
    expect(screen.getByTestId('elevation-profile-cursor').style.left).toBe('75%');
    expect(slider.getAttribute('aria-valuenow')).toBe('1.5');
  });
});
