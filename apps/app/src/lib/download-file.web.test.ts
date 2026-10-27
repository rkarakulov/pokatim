/// <reference types="jest" />
import { downloadFile } from './download-file';

const URL = 'https://api.example/v1/routes/0190a6f4-0000-7000-8000-000000000001/gpx';

describe('downloadFile (web, routes-03)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('клик по <a download> с адресом — синхронно, в той же вкладке, без opener и Referer; ссылка убрана', () => {
    const clicks: HTMLAnchorElement[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this);
    });
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    void downloadFile(URL);
    // в том же такте, что нажатие
    expect(clicks).toHaveLength(1);
    const link = clicks[0]!;
    expect(link.href).toBe(URL);
    expect(link.hasAttribute('download')).toBe(true);
    expect(link.target).toBe('');
    expect(link.rel).toBe('noopener noreferrer');
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('исключение — отклонённый промис без лога адреса', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(downloadFile(URL)).rejects.toThrow();
    expect(log.mock.calls.flat().join(' ')).not.toContain(URL);
  });
});
