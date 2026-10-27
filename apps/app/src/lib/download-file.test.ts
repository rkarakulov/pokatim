/// <reference types="jest" />
import { downloadFile } from './download-file';
import { openExternalUrl } from './open-external-url';

jest.mock('./open-external-url', () => ({ openExternalUrl: jest.fn() }));

const open = jest.mocked(openExternalUrl);
const URL = 'https://api.example/v1/routes/0190a6f4-0000-7000-8000-000000000001/gpx';

describe('downloadFile (native, routes-03)', () => {
  beforeEach(() => open.mockReset());

  it('системный браузер — openExternalUrl с тем же адресом', async () => {
    open.mockResolvedValue(undefined);
    await expect(downloadFile(URL)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(URL);
  });

  it('отказ ОС — отклонённый промис, адрес не логируется', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    open.mockRejectedValue(new Error('no browser'));
    await expect(downloadFile(URL)).rejects.toThrow();
    expect([...log.mock.calls, ...warn.mock.calls].flat().join(' ')).not.toContain(URL);
    log.mockRestore();
    warn.mockRestore();
  });
});
