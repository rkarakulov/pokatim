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
