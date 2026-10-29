/// <reference types="jest" />
import { APP_THEME_IDS } from '@pokatim/contracts';
import { appThemes, THEME_PREVIEWS } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';

import { ThemePreview } from './theme-preview';

const hidden = { includeHiddenElements: true };

describe('ThemePreview (user-theme A12)', () => {
  it.each(APP_THEME_IDS)('%s — макет на каждую схему темы, цвета из реестра', async (id) => {
    await render(<ThemePreview themeId={id} />);
    const mocks = screen.getAllByTestId('theme-preview-mock', hidden);
    const expected = THEME_PREVIEWS[id].mocks;
    expect(mocks).toHaveLength(appThemes[id].colorScheme === 'dark' ? 1 : 2);
    mocks.forEach((mock, index) =>
      expect(mock).toHaveStyle({ backgroundColor: expected[index]!.canvas }),
    );
  });

  it('скрыто от скринридера — смысл несут подписи строки', async () => {
    await render(<ThemePreview themeId="atlas" />);
    expect(screen.queryAllByTestId('theme-preview-mock')).toHaveLength(0);
    expect(screen.getByTestId('theme-preview', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
  });
});
