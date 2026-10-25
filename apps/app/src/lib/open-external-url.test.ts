/// <reference types="jest" />
import * as Linking from 'expo-linking';

import { openExternalUrl } from './open-external-url';

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const openURL = jest.mocked(Linking.openURL);
const URL = 'https://example.com/registration';

describe('openExternalUrl (native)', () => {
  beforeEach(() => openURL.mockReset());

  it('системный браузер: Linking.openURL с тем же адресом', async () => {
    openURL.mockResolvedValue(true);
    await expect(openExternalUrl(URL)).resolves.toBeUndefined();
    expect(openURL).toHaveBeenCalledWith(URL);
  });

  it('отказ ОС — отклонённый промис, адрес не логируется', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    openURL.mockRejectedValue(new Error('no browser'));
    await expect(openExternalUrl(URL)).rejects.toThrow();
    expect([...log.mock.calls, ...warn.mock.calls].flat().join(' ')).not.toContain(URL);
    log.mockRestore();
    warn.mockRestore();
  });
});
