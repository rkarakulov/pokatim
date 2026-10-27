/// <reference types="jest" />
import { appThemes } from '@pokatim/design-tokens';
import { render } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

import { activeAppTheme, AppThemeContext } from '@/theme/app-theme-provider';

import { Icon } from './icon';

jest.mock('expo-symbols', () => ({ SymbolView: jest.fn(() => null) }));

const symbol = jest.mocked(SymbolView);
const lastProps = () => symbol.mock.calls.at(-1)?.[0];

afterEach(() => jest.clearAllMocks());

describe('Icon — обёртка expo-symbols', () => {
  it('имя iOS и Material Symbols; вес regular — без пропа weight; testID и цвет проброшены', async () => {
    await render(<Icon name="profile" size={24} color="#111111" testID="icon" />);
    expect(lastProps()).toEqual({
      name: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
      size: 24,
      tintColor: '#111111',
      testID: 'icon',
    });
  });

  it('filled — заливочный вариант iOS (Android/web — тот же Material Symbol)', async () => {
    await render(<Icon name="person" size={16} color="#5C5C5C" filled />);
    expect(lastProps()?.name).toEqual({ ios: 'person.fill', android: 'person', web: 'person' });
  });

  it('без заливочного варианта filled не меняет имя', async () => {
    await render(<Icon name="zoomIn" size={16} color="#5C5C5C" filled />);
    expect(lastProps()?.name).toEqual({ ios: 'plus', android: 'add', web: 'add' });
  });

  it('заливка по умолчанию — из темы', async () => {
    const theme = activeAppTheme(
      { ...appThemes.classic, icons: { weight: 'regular', filled: true } },
      'light',
    );
    await render(
      <AppThemeContext.Provider value={theme}>
        <Icon name="locate" size={24} color="#111111" />
      </AppThemeContext.Provider>,
    );
    expect(lastProps()?.name).toEqual({
      ios: 'location.fill',
      android: 'my_location',
      web: 'my_location',
    });
  });
});

describe('Icon — темы слайса C', () => {
  const themed = (weight: 'regular' | 'semibold') =>
    activeAppTheme({ ...appThemes.classic, icons: { weight, filled: false } }, 'light');

  it('вес semibold — файл Material Symbols 600 и вес iOS; ключ экземпляра — по весу', async () => {
    const { rerender } = await render(
      <AppThemeContext.Provider value={themed('semibold')}>
        <Icon name="home" size={18} color="#111111" />
      </AppThemeContext.Provider>,
    );
    const props = lastProps();
    expect(props?.weight).toEqual({
      ios: 'semibold',
      android: expect.objectContaining({ name: 'MaterialSymbols_600SemiBold' }),
    });
    const mounts = symbol.mock.calls.length;
    await rerender(
      <AppThemeContext.Provider value={themed('regular')}>
        <Icon name="home" size={18} color="#111111" />
      </AppThemeContext.Provider>,
    );
    expect(lastProps()?.weight).toBeUndefined();
    expect(symbol.mock.calls.length).toBeGreaterThan(mounts);
  });

  it.each([
    ['home', { ios: 'house', android: 'home', web: 'home' }],
    ['races', { ios: 'flag.checkered', android: 'sports_score', web: 'sports_score' }],
    ['rides', { ios: 'cup.and.saucer', android: 'local_cafe', web: 'local_cafe' }],
    ['routes', { ios: 'map', android: 'map', web: 'map' }],
    ['calendar', { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }],
    ['arrowRight', { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }],
    ['chevronRight', { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }],
  ] as const)('%s — имена символов', async (name, expected) => {
    await render(<Icon name={name} size={18} color="#111111" />);
    expect(lastProps()?.name).toEqual(expected);
  });

  it('вкладки с заливочным вариантом iOS: home, rides, routes', async () => {
    await render(<Icon name="rides" size={18} color="#111111" filled />);
    expect(lastProps()?.name).toMatchObject({ ios: 'cup.and.saucer.fill' });
    await render(<Icon name="home" size={18} color="#111111" filled />);
    expect(lastProps()?.name).toMatchObject({ ios: 'house.fill' });
    await render(<Icon name="routes" size={18} color="#111111" filled />);
    expect(lastProps()?.name).toMatchObject({ ios: 'map.fill' });
  });
});
