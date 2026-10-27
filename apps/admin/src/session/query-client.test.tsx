// @vitest-environment jsdom
import { focusManager, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from './query-client';

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

function List({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['admin', 'disputes'], queryFn });
  return <span>{query.data ?? 'загрузка'}</span>;
}

describe('createQueryClient — без повторных GET (B12)', () => {
  it('фокус окна и повторный монтаж сразу после загрузки не перезапрашивают; через 30 с — перезапрос', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const client = createQueryClient({ onUnauthorized: () => undefined });
    const queryFn = vi.fn().mockResolvedValue('споры');
    const view = render(
      <QueryClientProvider client={client}>
        <List queryFn={queryFn} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('споры')).toBeTruthy();

    // клик в окне панели: blur → focus
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    view.rerender(
      <QueryClientProvider client={client}>
        <span>другой экран</span>
      </QueryClientProvider>,
    );
    view.rerender(
      <QueryClientProvider client={client}>
        <List queryFn={queryFn} />
      </QueryClientProvider>,
    );
    expect(queryFn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 30_001);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
