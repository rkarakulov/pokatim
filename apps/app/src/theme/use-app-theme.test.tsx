/// <reference types="jest" />
import { themes } from '@pokatim/design-tokens';
import { renderHook } from '@testing-library/react-native';

import { useAppTheme } from './use-app-theme';

// системная схема базы — тёмная; роли без провайдера (`useTheme`) — как есть (светлые в jest)
jest.mock('@rkarakulov/ui', () => ({
  ...jest.requireActual<Record<string, unknown>>('@rkarakulov/ui'),
  useColorScheme: () => 'dark',
}));

describe('useAppTheme без провайдера', () => {
  it('«Классика»; схема — по системной схеме базы (не по подложке карты), роли — useTheme()', async () => {
    const { result } = await renderHook(() => useAppTheme());
    expect(result.current.id).toBe('classic');
    expect(result.current.scheme).toBe('dark');
    expect(result.current.colors).toBe(themes.light);
  });
});
