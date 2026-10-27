/// <reference types="jest" />
import type { CatalogRouteElevation } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { renderToString } from 'react-dom/server';

import { ProfileChart } from './profile-chart';
import { PROFILE_FILL_OPACITY } from './profile-style';

const elevation: CatalogRouteElevation = {
  minM: 191,
  maxM: 267,
  profile: Array.from({ length: 300 }, (_, i) => [i * 227, 191 + (i % 77)]),
};

describe('ProfileChart web (fix профиля routes-03)', () => {
  it('плавный SVG-путь по всем точкам: линия map.corridor и светлая заливка, без столбиков; SSR детерминирован', () => {
    const html = renderToString(<ProfileChart elevation={elevation} theme={themes.light} />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toContain(`fill-opacity="${PROFILE_FILL_OPACITY}"`);
    expect(html).toContain(`stroke="${themes.light.map.corridor}"`);
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).not.toContain('elevation-profile-bar');
    // линия — по каждой точке профиля: M + 299 × L
    const line = /<path d="(M[^"]+)" fill="none"/.exec(html)?.[1] ?? '';
    expect(line.split('L')).toHaveLength(300);
    expect(renderToString(<ProfileChart elevation={elevation} theme={themes.light} />)).toBe(html);
  });

  it('тёмная тема — свой приглушённый цвет; меньше двух точек — пусто', () => {
    const html = renderToString(<ProfileChart elevation={elevation} theme={themes.dark} />);
    expect(html).toContain(`stroke="${themes.dark.map.corridor}"`);
    expect(
      renderToString(
        <ProfileChart elevation={{ minM: 1, maxM: 1, profile: [[0, 1]] }} theme={themes.dark} />,
      ),
    ).toBe('');
  });
});
