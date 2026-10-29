/// <reference types="jest" />
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';
import { createTestQueryClient } from '@/__tests__/query-wrapper';
import { appearanceKeys } from '@/features/appearance/appearance-query';
import { api } from '@/lib/api';

import { DecorLayer } from './decor-layer';
import { HalloweenDecor } from './halloween-decor';

jest.mock('@/lib/api', () => ({ api: { getAppearance: jest.fn() } }));

const getAppearance = jest.mocked(api.getAppearance);

function tree(children: ReactNode, client = createTestQueryClient()) {
  const Theme = appThemeWrapper('classic');
  return (
    <QueryClientProvider client={client}>
      <Theme>{children}</Theme>
    </QueryClientProvider>
  );
}

afterEach(() => jest.clearAllMocks());

describe('DecorLayer web (halloween-decor AC4, AC5)', () => {
  it('SSR — без декора даже при известном ответе (гидрация без рассинхрона)', () => {
    const client = createTestQueryClient();
    client.setQueryData(appearanceKeys.current, { themeId: 'classic', decor: 'halloween' });
    expect(renderToString(tree(<DecorLayer />, client))).toBe('');
  });

  it('после монтирования — слой по ответу сервера', async () => {
    getAppearance.mockResolvedValue({ themeId: 'classic', decor: 'halloween' });
    render(tree(<DecorLayer />));
    expect(await screen.findByTestId('halloween-decor')).toBeTruthy();
  });

  it('none — без слоя', async () => {
    getAppearance.mockResolvedValue({ themeId: 'classic', decor: 'none' });
    render(tree(<DecorLayer />));
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    expect(screen.queryByTestId('halloween-decor')).toBeNull();
  });
});

describe('HalloweenDecor web (AC5)', () => {
  it('aria-hidden, pointer-events none; inline svg; reduce motion выключает анимации', () => {
    render(tree(<HalloweenDecor />));
    const layer = screen.getByTestId('halloween-decor');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.querySelectorAll('svg').length).toBeGreaterThan(5);
    expect(layer.querySelector('style')?.textContent).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.pokatim-decor-bob \{ animation: none; \}/,
    );
    expect(screen.getByTestId('halloween-spider').className).toBe('pokatim-decor-bob');
    expect(screen.getByTestId('halloween-witch').className).toBe('pokatim-decor-fly');
    // reduce motion: вместо пролёта — ведьма внизу слева (верх с заголовком свободен)
    expect(screen.getByTestId('halloween-witch-still').className).toBe('pokatim-decor-still');
    expect(layer.querySelector('style')?.textContent).toMatch(
      /\.pokatim-decor-fly \{ display: none; \}/,
    );
  });
});
