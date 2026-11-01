/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

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

describe('SectionHero с фото: серверный HTML (SSR, ride-photo-followups AC1)', () => {
  const Theme = appThemeWrapper('classic');
  const ssr = (photo: string | null) =>
    renderToString(
      <Theme>
        <SectionHero kicker="Райд" date={{ value: '3' }} title="Кофе-райд" photo={photo} />
      </Theme>,
    );

  it('фото — <img src alt=""> уже в серверной разметке (до эффектов), затемнение тоже', () => {
    const html = ssr(URI);
    const img = /<img\b[^>]*>/.exec(html)?.[0];
    expect(img).toBeDefined();
    expect(img).toContain(`src="${URI}"`);
    expect(img).toContain('alt=""');
    expect(html).toContain('data-testid="photo-scrim"');
  });

  it('без фото — ни картинки, ни затемнения', () => {
    const html = ssr(null);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('photo-scrim');
  });
});

describe('SectionHero с фото: ошибка картинки (web)', () => {
  const hero = () => (
    <SectionHero kicker="Райд" date={{ value: '3' }} title="Кофе-райд" photo={URI} />
  );
  const photo = (container: HTMLElement) =>
    container.querySelector('[data-testid="section-hero-photo"]');
  const scrim = (container: HTMLElement) => container.querySelector('[data-testid="photo-scrim"]');

  afterEach(() => jest.restoreAllMocks());

  it('событие error — типографский герой', () => {
    const { container } = render(hero(), { wrapper: appThemeWrapper('classic') });
    fireEvent.error(photo(container)!);
    expect(photo(container)).toBeNull();
    expect(scrim(container)).toBeNull();
  });

  it('картинка сломалась до гидрации (complete, naturalWidth 0) — типографский после монтирования', () => {
    jest.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    jest.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    const { container } = render(hero(), { wrapper: appThemeWrapper('classic') });
    expect(photo(container)).toBeNull();
    expect(scrim(container)).toBeNull();
  });

  it('картинка уже загрузилась до гидрации (naturalWidth > 0) — фото остаётся', () => {
    jest.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    jest.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1600);
    const { container } = render(hero(), { wrapper: appThemeWrapper('classic') });
    expect(photo(container)).not.toBeNull();
  });
});
