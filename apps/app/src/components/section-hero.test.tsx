/// <reference types="jest" />
import { size, themes } from '@pokatim/design-tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

  it('с onPress — ссылка с той же меткой, нажатие вызывает переход (блок 03)', async () => {
    const onPress = jest.fn();
    await render(
      <SectionHero kicker="Окно гонки" date={{ value: '1' }} title="Гонка" onPress={onPress} />,
    );

    const link = screen.getByRole('link', { name: 'Окно гонки. Гонка. 1' });
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  describe('с фото (ride-photo P4)', () => {
    const URI = 'https://api.test/v1/ride-photos/PhOtO';

    it('фото cover под затемнением, текст и линия — onPhoto; фото декоративное, метка блока та же', async () => {
      await render(
        <SectionHero
          kicker="Ближайший райд"
          date={{ value: 'Сб 3 октября, 9:00' }}
          title="Кофе-райд"
          meta={['42 км']}
          photo={URI}
        />,
      );

      const hero = screen.getByLabelText('Ближайший райд. Кофе-райд. Сб 3 октября, 9:00');
      expect(hero).toHaveProp('accessible', true);
      const photo = screen.getByTestId('section-hero-photo', { includeHiddenElements: true });
      expect(photo.props.source).toEqual({ uri: URI });
      expect(photo.props.contentFit).toBe('cover');
      expect(photo.props.accessible).toBe(false);
      expect(photo.props.accessibilityLabel).toBe('');
      expect(screen.getByTestId('photo-scrim', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('Кофе-райд')).toHaveStyle({ color: light.text.onPhoto });
      expect(screen.getByText('Ближайший райд')).toHaveStyle({ color: light.text.onPhoto });
      expect(screen.getByText('Сб 3 октября, 9:00')).toHaveStyle({ color: light.text.onPhoto });
      expect(screen.getByTestId('section-hero-rule')).toHaveStyle({
        backgroundColor: light.text.onPhoto,
      });
      // мета — под героем на поверхности экрана, как без фото
      expect(screen.getByText('42 км')).toHaveStyle({ color: light.text.secondary });
    });

    it('фото не загрузилось — типографский герой', async () => {
      await render(<SectionHero kicker="Райд" date={{ value: '3' }} title="Кофе" photo={URI} />);
      await fireEvent(
        screen.getByTestId('section-hero-photo', { includeHiddenElements: true }),
        'error',
      );
      expect(
        screen.queryByTestId('section-hero-photo', { includeHiddenElements: true }),
      ).toBeNull();
      expect(screen.queryByTestId('photo-scrim', { includeHiddenElements: true })).toBeNull();
      expect(screen.getByText('Кофе')).toHaveStyle({ color: light.text.primary });
    });

    it('без фото (null) — типографский герой без затемнения', async () => {
      await render(<SectionHero kicker="Райд" date={{ value: '3' }} title="Кофе" photo={null} />);
      expect(screen.queryByTestId('photo-scrim', { includeHiddenElements: true })).toBeNull();
      expect(screen.getByLabelText('Райд. Кофе. 3')).toHaveStyle({
        backgroundColor: light.surface.raised,
      });
    });
  });
});
