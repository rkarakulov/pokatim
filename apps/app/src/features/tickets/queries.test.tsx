/// <reference types="jest" />
import type { TicketView } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { liveSession } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { raceTicket, ticketRef } from './fixtures';
import { saveOfflineTicket } from './offline-store';
import { forgetCancelledTicket, ticketKeys, useMyTickets } from './queries';

jest.mock('@/lib/api');
jest.mock('./offline-store', () => ({
  saveOfflineTicket: jest.fn(async () => undefined),
  readOfflineTicket: jest.fn(async () => null),
  removeOfflineTicket: jest.fn(async () => undefined),
  clearOfflineTickets: jest.fn(async () => undefined),
}));

afterEach(() => jest.clearAllMocks());

describe('предзагрузка билета и отмена (ревью pass 2, MEDIUM)', () => {
  it('ответ предзагрузки, начатой до отмены, не восстанавливает копию и данные запроса', async () => {
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    jest.mocked(api.listTickets).mockResolvedValue({ upcoming: [ticketRef(raceTicket)], past: [] });
    let resolve: (view: TicketView) => void = () => undefined;
    jest.mocked(api.getTicket).mockReturnValue(new Promise((done) => (resolve = done)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    await renderHook(() => useMyTickets(true), { wrapper });
    await waitFor(() => expect(api.getTicket).toHaveBeenCalled());

    forgetCancelledTicket(client, raceTicket.code);
    await act(async () => resolve(raceTicket));

    expect(saveOfflineTicket).not.toHaveBeenCalled();
    expect(client.getQueryData(ticketKeys.detail(raceTicket.code))).toBeUndefined();
  });
});
