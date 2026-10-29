/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createQueryWrapper, createTestQueryClient } from '@/__tests__/query-wrapper';
import { api } from '@/lib/api';
import { prepareShareImage } from '@/lib/share-image';

import { useShareImage } from './use-share-image';

jest.mock('@/lib/api');
jest.mock('@/lib/share-image', () => ({
  shareImageSupported: () => true,
  prepareShareImage: jest.fn(),
}));

const ID = '0190a6f4-0000-7000-8000-000000000001';
const image = { uri: 'file:///cache/og.png' };

describe('useShareImage', () => {
  afterEach(() => jest.clearAllMocks());

  it('готовит PNG по версии от API', async () => {
    jest.mocked(api.getOgCard).mockResolvedValue({ version: '0123456789abcdef' });
    jest.mocked(api.ogImageUrl).mockReturnValue('https://api.test/og.png');
    jest.mocked(prepareShareImage).mockResolvedValue(image);
    const { result } = await renderHook(() => useShareImage('route', ID, true), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current).toEqual(image));
    expect(prepareShareImage).toHaveBeenCalledWith('https://api.test/og.png');
  });

  it('повторный запрос упал (404) после успешной подготовки — прежняя картинка не отдаётся', async () => {
    jest.mocked(api.getOgCard).mockResolvedValue({ version: '0123456789abcdef' });
    jest.mocked(api.ogImageUrl).mockReturnValue('https://api.test/og.png');
    jest.mocked(prepareShareImage).mockResolvedValue(image);
    const client = createTestQueryClient();
    const { result } = await renderHook(() => useShareImage('route', ID, true), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => expect(result.current).toEqual(image));

    jest
      .mocked(api.getOgCard)
      .mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['share-image'] });
    });
    await waitFor(() => expect(result.current).toBeUndefined());
  });

  it('без своей картинки (kind = null) и выключенный — без запросов', async () => {
    const { result } = await renderHook(() => useShareImage(null, ID, true), {
      wrapper: createQueryWrapper(),
    });
    expect(result.current).toBeUndefined();
    await renderHook(() => useShareImage('ride', ID, false), { wrapper: createQueryWrapper() });
    expect(api.getOgCard).not.toHaveBeenCalled();
  });
});
