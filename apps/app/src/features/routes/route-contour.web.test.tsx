/// <reference types="jest" />
import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

import { RouteContour } from './route-contour';

const geometry = {
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
    [27.7, 53.9],
  ] as [number, number][],
  bounds: [27.5, 53.9, 27.7, 53.95] as [number, number, number, number],
};

describe('RouteContour web (app-themes C2)', () => {
  it('inline svg: линия цвета маршрута и точка старта, скрыт от скринридера; SSR = первый рендер', () => {
    const { container } = render(
      <RouteContour geometry={geometry} color="#D9480F" startColor="#C2410C" />,
    );
    const svg = container.querySelector('svg[data-testid="route-contour"]')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')!.getAttribute('stroke')).toBe('#D9480F');
    // старт — кружок цвета старта с обводкой цветом линии: виден на линии при любом сочетании
    expect(svg.querySelector('circle')!.getAttribute('fill')).toBe('#C2410C');
    expect(svg.querySelector('circle')!.getAttribute('stroke')).toBe('#D9480F');
    expect(
      renderToString(<RouteContour geometry={geometry} color="#D9480F" startColor="#C2410C" />),
    ).toContain(`d="${svg.querySelector('path')!.getAttribute('d')}"`);
  });

  it('вырожденная рамка — ничего', () => {
    const { container } = render(
      <RouteContour
        geometry={{
          line: [
            [27.5, 53.9],
            [27.5, 53.9],
          ],
          bounds: [27.5, 53.9, 27.5, 53.9],
        }}
        color="#D9480F"
        startColor="#C2410C"
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
