/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getDocumentAsync } from 'expo-document-picker';
import type { ReactNode } from 'react';

import { liveSession, signInForTest } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { RidePhotoSection } from './ride-photo-section';

// web-проект: automock исполнил бы модуль (клиент API без `fetch` в jsdom) — только нужные методы
jest.mock('@/lib/api', () => ({
  api: { uploadRidePhoto: jest.fn(), deleteRidePhoto: jest.fn() },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const RIDE_ID = '0190a6f4-0000-7000-8000-000000000011';

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<RidePhotoSection rideId={RIDE_ID} photo={null} />, { wrapper });
}

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('RidePhotoSection (web, ride-photo PR B)', () => {
  it('диалог файла открыт (браузер без `cancel` не вернёт ответ) — кнопка не занята; занята только на время запроса', async () => {
    jest.mocked(getDocumentAsync).mockReturnValueOnce(new Promise(() => undefined));
    renderSection();
    const add = screen.getByRole('button', { name: 'Добавить своё фото' });
    fireEvent.click(add);
    await waitFor(() => expect(getDocumentAsync).toHaveBeenCalled());
    expect(add.getAttribute('aria-busy')).not.toBe('true');

    const file = new File(['x'], 'ride.jpg', { type: 'image/jpeg' });
    jest.mocked(getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ name: file.name, uri: 'blob:x', file } as never],
    });
    jest.mocked(api.uploadRidePhoto).mockReturnValueOnce(new Promise(() => undefined));
    fireEvent.click(add);
    await waitFor(() => expect(api.uploadRidePhoto).toHaveBeenCalled());
    await waitFor(() => expect(add.getAttribute('aria-busy')).toBe('true'));
  });
});
