/// <reference types="jest" />
import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { downloadFile } from './download-file';
import { prepareStory, shareStory, storyShareMode } from './share-story';

jest.mock('./download-file', () => ({ downloadFile: jest.fn() }));
jest.mock('./load-expo-sharing', () => ({
  loadExpoSharing: () => Promise.resolve(jest.requireMock('expo-sharing')),
}));
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const URL = 'https://api.example/v1/story-cards/AbCdEfGhIjKlMnOpQrSt_-.png';
const optional = jest.mocked(requireOptionalNativeModule);
const download = jest.mocked(File.downloadFileAsync);

describe('share-story (native)', () => {
  beforeEach(() => {
    optional.mockReset();
    jest.mocked(shareAsync).mockReset();
    jest.mocked(downloadFile).mockReset();
  });

  it('PNG скачивается в кэш (перезапись), системный лист — image/png', async () => {
    download.mockResolvedValue({ uri: 'file:///cache/story.png' } as never);
    optional.mockReturnValue({});
    const story = await prepareStory(URL);
    expect(download).toHaveBeenCalledWith(URL, expect.anything(), { idempotent: true });
    expect(download.mock.calls[0]![1]).toMatchObject({
      uri: 'file:///cache/story-AbCdEfGhIjKlMnOpQrSt_-.png',
    });
    expect(story).toEqual({ url: URL, uri: 'file:///cache/story.png' });
    expect(storyShareMode(story)).toBe('share');
    await expect(shareStory(story, 'Карточка')).resolves.toBe('shared');
    expect(shareAsync).toHaveBeenCalledWith('file:///cache/story.png', {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Карточка',
    });
  });

  it('нет ExpoSharing (старая сборка) — режим download и downloadFile', async () => {
    optional.mockReturnValue(null);
    const story = { url: URL, uri: 'file:///cache/story.png' };
    expect(storyShareMode(story)).toBe('download');
    await expect(shareStory(story)).resolves.toBe('downloaded');
    expect(downloadFile).toHaveBeenCalledWith(URL);
    expect(shareAsync).not.toHaveBeenCalled();
  });
});
