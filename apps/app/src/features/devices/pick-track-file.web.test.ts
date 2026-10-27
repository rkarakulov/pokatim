/// <reference types="jest" />
import { getDocumentAsync } from 'expo-document-picker';

import { pickTrackFile } from './pick-track-file';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const pick = jest.mocked(getDocumentAsync);

afterEach(() => {
  jest.clearAllMocks();
});

describe('pickTrackFile (web): фильтр расширений', () => {
  it('заезд по умолчанию — .fit/.gpx; маршрут (routes-02) — .gpx/.kml; отправляется сам File', async () => {
    const file = new Blob(['<kml/>']);
    pick.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'a.kml', uri: 'blob:x', file } as never],
    });
    await expect(pickTrackFile()).resolves.toMatchObject({ name: 'a.kml', file });
    expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({ type: ['.fit', '.gpx'] }));
    await pickTrackFile(['gpx', 'kml']);
    expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({ type: ['.gpx', '.kml'] }));
  });

  it('отмена — null', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickTrackFile(['gpx', 'kml'])).resolves.toBeNull();
  });
});
