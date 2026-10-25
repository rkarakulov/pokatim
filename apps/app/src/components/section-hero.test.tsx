/// <reference types="jest" />
import { size, themes } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';

import { SectionHero } from './section-hero';

const light = themes.light;

describe('SectionHero (типографский герой раздела)', () => {
  it('кикер → дата крупно с подписью → название; для скринридера — одна метка «кикер. название. даты»', async () => {
    await render(
      <SectionHero
        kicker="Окно гонки"
        date={{ value: '4–12', unit: 'октября' }}
        title="Гравийный коридор"
        meta={['62 км · гравий', 'Окно открыто до 12 октября, 23:59.']}
      />,
    );

    const hero = screen.getByLabelText('Окно гонки. Гравийный коридор. 4–12 октября');
    expect(hero).toHaveProp('accessible', true);
    expect(hero).toHaveStyle({ minHeight: size.heroHeight, backgroundColor: light.surface.raised });
    expect(screen.getByText('4–12')).toHaveStyle({ fontFamily: 'PlayfairDisplay_600SemiBold' });
    expect(screen.getByText('октября')).toHaveStyle({ color: light.text.secondary });
    expect(screen.getByText('Гравийный коридор')).toHaveStyle({
      fontFamily: 'PlayfairDisplay_500Medium',
      color: light.text.primary,
    });
    expect(screen.getByTestId('section-hero-rule')).toHaveStyle({
      backgroundColor: light.text.primary,
    });
    expect(screen.getByText('62 км · гравий')).toHaveStyle({ color: light.text.secondary });
    expect(screen.getByText('Окно открыто до 12 октября, 23:59.')).toBeOnTheScreen();
  });

  it('герой не нажимается (Q6); без подписи даты и меты — только дата и название', async () => {
    await render(<SectionHero kicker="Ближайший старт" date={{ value: '14' }} title="Старт" />);

    expect(screen.getByLabelText('Ближайший старт. Старт. 14')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('длинное название переносится, а не обрезается (крупный шрифт)', async () => {
    const title = 'Очень длинное название гонки, которое не помещается в одну строку героя';
    await render(<SectionHero kicker="Окно гонки" date={{ value: '1' }} title={title} />);
    expect(screen.getByText(title)).not.toHaveProp('numberOfLines');
  });
});
