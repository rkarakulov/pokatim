/// <reference types="jest" />
import { render, screen } from '@testing-library/react';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { SectionHero } from './section-hero';

const URI = 'https://api.test/v1/ride-photos/PhOtO';

describe('SectionHero с фото (web, ride-photo P4)', () => {
  it('фото — декоративное (пустой alt), ссылка героя с той же меткой; затемнение скрыто от скринридера', async () => {
    const { container } = render(
      <SectionHero
        kicker="Ближайший райд"
        date={{ value: 'Сб 3 октября, 9:00' }}
        title="Кофе-райд"
        photo={URI}
        onPress={() => undefined}
      />,
      { wrapper: appThemeWrapper('classic') },
    );

    expect(
      screen.getByRole('link', { name: 'Ближайший райд. Кофе-райд. Сб 3 октября, 9:00' }),
    ).toBeTruthy();
    const img = container.querySelector(`img[src="${URI}"]`);
    expect(img).not.toBeNull();
    expect(img!.getAttribute('alt')).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      container.querySelector('[data-testid="photo-scrim"]')!.getAttribute('aria-hidden'),
    ).toBe('true');
  });
});
