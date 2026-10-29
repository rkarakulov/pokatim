import {
  dismissInstallPrompt,
  MS_IN_DAY,
  readInstallPromptState,
  registerVisit,
  REMIND_AFTER_CLOSE_MS,
} from './install-prompt-state';

describe('счётчик плашки установки', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('отложка после «×» — 7 дней', () => {
    expect(REMIND_AFTER_CLOSE_MS).toBe(7 * MS_IN_DAY);
  });

  it('при старте showDialog false, время закрытия — из хранилища', () => {
    expect(readInstallPromptState(null)).toEqual({ showDialog: false });
    expect(
      readInstallPromptState(JSON.stringify({ showDialog: true, closedTimestamp: 42 })),
    ).toEqual({ showDialog: false, closedTimestamp: 42 });
  });

  it('старое значение со счётчиком визитов читается без него', () => {
    expect(
      readInstallPromptState(JSON.stringify({ visitsCountAfterClosing: 3, closedTimestamp: 42 })),
    ).toEqual({ showDialog: false, closedTimestamp: 42 });
  });

  it('испорченное значение хранилища — как новый пользователь', () => {
    expect(readInstallPromptState('{')).toEqual({ showDialog: false });
    expect(readInstallPromptState(JSON.stringify({ closedTimestamp: 'x' }))).toEqual({
      showDialog: false,
    });
    expect(readInstallPromptState(JSON.stringify('x'))).toEqual({ showDialog: false });
  });

  it('новый пользователь видит плашку с первого визита', () => {
    expect(registerVisit(readInstallPromptState(null), Date.now())).toEqual({ showDialog: true });
  });

  it('«×» скрывает плашку и запоминает время закрытия', () => {
    expect(dismissInstallPrompt(Date.now())).toEqual({
      showDialog: false,
      closedTimestamp: Date.now(),
    });
  });

  it('после «×» — не раньше чем через 7 дней, сколько бы ни было визитов', () => {
    const closed = dismissInstallPrompt(Date.now());
    jest.advanceTimersByTime(REMIND_AFTER_CLOSE_MS - 1);
    expect(registerVisit(registerVisit(closed, Date.now()), Date.now()).showDialog).toBe(false);
    jest.advanceTimersByTime(1);
    expect(registerVisit(closed, Date.now())).toEqual({
      showDialog: true,
      closedTimestamp: closed.closedTimestamp,
    });
  });
});
