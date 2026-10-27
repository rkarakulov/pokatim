// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './camera.ts';
import { guardWheelZoom, interactiveMapOptions } from './map-options.ts';

describe('interactiveMapOptions (routes-05, A2, RC-2)', () => {
  it('один палец и мышь: без кооперативного режима; зум 2–17; вращение и наклон выключены; камера по рамке без анимации', () => {
    const options = interactiveMapOptions({ bounds: [27.5, 53.8, 27.7, 54.0], padding: 32 });
    expect(options).toMatchObject({
      interactive: true,
      cooperativeGestures: false,
      dragPan: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      minZoom: 2,
      maxZoom: 17,
      attributionControl: { compact: true },
      bounds: [27.5, 53.8, 27.7, 54.0],
      fitBoundsOptions: { padding: 32, animate: false },
    });
    expect([MAP_MIN_ZOOM, MAP_MAX_ZOOM]).toEqual([2, 17]);
    expect(options.locale).toEqual({ 'Map.Title': expect.any(String) });
  });
});

describe('guardWheelZoom (routes-04c, RC-2)', () => {
  /** Контейнер карты и внутренний узел холста со слушателем колеса (как `scrollZoom` maplibre-gl). */
  function setup() {
    const container = document.createElement('div');
    const canvas = document.createElement('div');
    container.append(canvas);
    document.body.append(container);
    const scrollZoom = vi.fn();
    canvas.addEventListener('wheel', scrollZoom);
    const onBlocked = vi.fn();
    const release = guardWheelZoom(container, onBlocked);
    const wheel = (init: WheelEventInit = {}) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
      canvas.dispatchEvent(event);
      return event;
    };
    return { scrollZoom, onBlocked, release, wheel };
  }

  it('без модификатора — до холста не доходит, прокрутка страницы не отменена, onBlocked', () => {
    const { scrollZoom, onBlocked, wheel } = setup();
    const event = wheel({ deltaY: 100 });
    expect(scrollZoom).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it.each(['ctrlKey', 'metaKey'] as const)('с %s — доходит до холста, подсказки нет', (key) => {
    const { scrollZoom, onBlocked, wheel } = setup();
    wheel({ [key]: true });
    expect(scrollZoom).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('отписка — колесо снова доходит до холста', () => {
    const { scrollZoom, onBlocked, release, wheel } = setup();
    release();
    wheel();
    expect(scrollZoom).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
