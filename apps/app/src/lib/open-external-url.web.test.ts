/// <reference types="jest" />
import { openExternalUrl } from './open-external-url';

const URL = 'https://example.com/registration';

describe('openExternalUrl (web)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('новая вкладка без opener и Referer — синхронно, до первого await', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    void openExternalUrl(URL);
    // вызов в том же такте, что нажатие: блокировщик всплывающих окон не срабатывает
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
  });

  it('null от window.open (так всегда при noopener) — не ошибка', async () => {
    jest.spyOn(window, 'open').mockReturnValue(null);
    await expect(openExternalUrl(URL)).resolves.toBeUndefined();
  });

  it('исключение — отклонённый промис без лога адреса', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(openExternalUrl(URL)).rejects.toThrow();
    expect(log.mock.calls.flat().join(' ')).not.toContain(URL);
  });
});
