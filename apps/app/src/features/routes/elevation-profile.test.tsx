/// <reference types="jest" />
import type { CatalogRouteElevation } from '@pokatim/contracts';
import { contrastRatio, themes, WCAG } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';

import { ElevationProfile, PROFILE_BARS } from './elevation-profile';

const elevation: CatalogRouteElevation = {
  minM: 191,
  maxM: 267,
  // первая половина — 191 м, вторая — 267 м: крайние столбики — мин. и макс.
  profile: Array.from({ length: 300 }, (_, i) => [i * 227, i < 150 ? 191 : 267]),
};

describe('ElevationProfile (routes-03, P4, RC-7)', () => {
  it('заголовок, диапазон справа, график — одно изображение с текстовой альтернативой, подписи км', async () => {
    await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />);
    expect(screen.getByRole('header', { name: 'Профиль высоты' })).toBeOnTheScreen();
    expect(screen.getByText('191–267 м')).toBeOnTheScreen();
    const chart = screen.getByRole('image');
    expect(chart).toHaveProp('accessibilityLabel', 'Профиль высоты: от 191 до 267 м, набор 620 м');
    // столбики и подписи оси скрыты от скринридера
    expect(screen.queryAllByTestId('elevation-profile-bar')).toHaveLength(0);
    const bars = screen.getAllByTestId('elevation-profile-bar', { includeHiddenElements: true });
    expect(bars).toHaveLength(PROFILE_BARS);
    expect(bars[0]).toHaveStyle({ height: '8%' });
    expect(bars.at(-1)).toHaveStyle({ height: '100%' });
    for (const label of ['0', '20', '40', '60 км']) {
      expect(screen.getByText(label, { includeHiddenElements: true })).toBeOnTheScreen();
    }
  });

  it('нет профиля — блока нет; без набора — альтернатива без набора', async () => {
    await render(<ElevationProfile elevation={null} distanceM={68_000} gainM={null} />);
    expect(screen.queryByTestId('elevation-profile')).toBeNull();
    await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={null} />);
    expect(screen.getByRole('image')).toHaveProp(
      'accessibilityLabel',
      'Профиль высоты: от 191 до 267 м',
    );
  });

  it('SSR-безопасно: без onLayout, повторный рендер идентичен; разметка зависит только от данных', async () => {
    const view = await render(
      <ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />,
    );
    const first = JSON.stringify(view.toJSON());
    expect(first).not.toContain('onLayout');
    await view.rerender(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />);
    expect(JSON.stringify(view.toJSON())).toBe(first);
  });

  it('цвет площади (map.route) контрастен фону карточки в обеих темах (WCAG для графики)', () => {
    for (const theme of [themes.light, themes.dark]) {
      expect(contrastRatio(theme.map.route, theme.surface.default)).toBeGreaterThanOrEqual(WCAG.ui);
    }
  });
});
