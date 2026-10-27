// @vitest-environment jsdom
import { focusManager, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from './query-client';

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

function List({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['admin', 'disputes'], queryFn });
  return <span>{query.data ?? 'загрузка'}</span>;
}

describe('createQueryClient — без повторных GET (B12)', () => {
  it('фокус окна не перезапрашивает; заход на экран — один свежий запрос (погасшая сессия видна сразу)', async () => {
    const client = createQueryClient({ onUnauthorized: () => undefined });
    const queryFn = vi.fn().mockResolvedValue('споры');
    const screenWith = (content: React.ReactNode) => (
      <QueryClientProvider client={client}>{content}</QueryClientProvider>
    );
    const view = render(screenWith(<List queryFn={queryFn} />));
    expect(await screen.findByText('споры')).toBeTruthy();

    // клик в окне панели: blur → focus
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(queryFn).toHaveBeenCalledTimes(1);

    // уход на другой экран и возврат — данные перечитываются
    view.rerender(screenWith(<span>другой экран</span>));
    view.rerender(screenWith(<List queryFn={queryFn} />));
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
