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

  it('mailto: — почтовый клиент в той же вкладке, без пустой новой вкладки', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    // jsdom не переходит по mailto: (`location` не подменить) — проверяем, что новой вкладки нет и ошибки нет
    await expect(openExternalUrl('mailto:help@pokatim.by')).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it('geo: (карты на Android) — приложение карт из той же вкладки, без пустой новой вкладки', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    await expect(
      openExternalUrl('geo:0,0?q=%D0%9C%D0%B8%D0%BD%D1%81%D0%BA'),
    ).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
