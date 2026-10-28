/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getDocumentAsync } from 'expo-document-picker';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';
import { liveSession, signInForTest } from '@/__tests__/auth-fixtures';

import { AvatarEditor } from './avatar-editor';

// web-проект: automock исполнил бы модуль (клиент API без `fetch` в jsdom) — только нужные методы
jest.mock('@/lib/api', () => ({
  api: {
    uploadAvatar: jest.fn(),
    deleteAvatar: jest.fn(),
    avatarUrl: jest.fn((id: string) => `https://api.test/v1/avatars/${id}`),
  },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const file = new File(['x'], 'me.png', { type: 'image/png' });
const profile = {
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  club: null,
  avatar: { id: 'a1' },
  publicId: null,
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = render(<AvatarEditor avatarId={null} />, { wrapper });
  return { view, client };
}

async function pickAndLoad(view: ReturnType<typeof render>) {
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать фото' }));
  const image = await waitFor(() => {
    const element = view.container.querySelector('img[alt=""]');
    if (!element) throw new Error('нет фото');
    return element as HTMLImageElement;
  });
  Object.defineProperty(image, 'naturalWidth', { value: 1000 });
  Object.defineProperty(image, 'naturalHeight', { value: 1000 });
  fireEvent.load(image);
}

beforeAll(() => {
  Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:avatar'), revokeObjectURL: jest.fn() });
});
beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  jest.mocked(getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ name: file.name, uri: 'blob:x', file } as never],
  });
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('AvatarEditor (web, rider-profile AC14)', () => {
  it('выбор → панель обрезки → «Сохранить фото»: исходник и доли квадрата; ответ — в кэш, панель закрыта', async () => {
    jest.mocked(api.uploadAvatar).mockResolvedValue(profile);
    const { view, client } = renderEditor();
    await pickAndLoad(view);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }));

    await waitFor(() =>
      expect(api.uploadAvatar).toHaveBeenCalledWith(liveSession.accessToken, file, {
        x: 0,
        y: 0,
        size: 1,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Сохранить фото' })).toBeNull(),
    );
    expect(client.getQueryData(['profile'])).toEqual(profile);
  });

  it('отказ сервера — баннер, панель обрезки остаётся для повтора', async () => {
    jest
      .mocked(api.uploadAvatar)
      .mockRejectedValue(new ApiHttpError(422, { code: 'AVATAR_INVALID', message: 'x' }));
    const { view } = renderEditor();
    await pickAndLoad(view);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить фото' }));
    expect(await screen.findByText('Не удалось обработать фото — выберите другое')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить фото' })).toBeTruthy();
  });

  it('HEIC — текст формата без панели обрезки и без запроса', async () => {
    jest.mocked(getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          name: 'me.heic',
          uri: 'blob:x',
          file: new File(['x'], 'me.heic', { type: 'image/heic' }),
        } as never,
      ],
    });
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фото' }));
    expect(await screen.findByText('Выберите фото в формате JPEG, PNG или WebP')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить фото' })).toBeNull();
    expect(api.uploadAvatar).not.toHaveBeenCalled();
  });
});
