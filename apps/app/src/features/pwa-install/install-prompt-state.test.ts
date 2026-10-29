import {
  dismissInstallPrompt,
  MS_IN_DAY,
  readInstallPromptState,
  registerVisit,
  REMIND_AFTER_CLOSE_MS,
  VISITS_BEFORE_PROMPT,
  type InstallPromptState,
} from './install-prompt-state';

const fresh: InstallPromptState = { showDialog: false, visitsCountAfterClosing: 0 };

/** `n` визитов подряд от состояния `from`. */
const visits = (from: InstallPromptState, n: number): InstallPromptState =>
  Array.from({ length: n }).reduce<InstallPromptState>(
    (state) => registerVisit(state, Date.now()),
    from,
  );

describe('счётчик плашки установки', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('константы: 5 визитов и 7 дней', () => {
    expect(VISITS_BEFORE_PROMPT).toBe(5);
    expect(REMIND_AFTER_CLOSE_MS).toBe(7 * MS_IN_DAY);
  });

  it('при старте showDialog всегда false, счётчик и время закрытия — из хранилища', () => {
    expect(readInstallPromptState(null)).toEqual(fresh);
    expect(
      readInstallPromptState(
        JSON.stringify({ showDialog: true, visitsCountAfterClosing: 7, closedTimestamp: 42 }),
      ),
    ).toEqual({ showDialog: false, visitsCountAfterClosing: 7, closedTimestamp: 42 });
  });

  it('испорченное значение хранилища — как новый пользователь', () => {
    expect(readInstallPromptState('{')).toEqual(fresh);
    expect(readInstallPromptState(JSON.stringify({ visitsCountAfterClosing: -1 }))).toEqual(fresh);
    expect(readInstallPromptState(JSON.stringify('x'))).toEqual(fresh);
  });

  it('новый пользователь видит плашку на 5-м визите, не раньше', () => {
    const fourth = visits(fresh, 4);
    expect(fourth).toEqual({ showDialog: false, visitsCountAfterClosing: 4 });
    expect(registerVisit(fourth, Date.now())).toEqual({
      showDialog: true,
      visitsCountAfterClosing: 5,
    });
  });

  it('«×» сбрасывает счётчик и запоминает время закрытия', () => {
    expect(dismissInstallPrompt(Date.now())).toEqual({
      showDialog: false,
      visitsCountAfterClosing: 0,
      closedTimestamp: Date.now(),
    });
  });

  it('после закрытия — снова через 5 визитов', () => {
    const closed = dismissInstallPrompt(Date.now());
    expect(visits(closed, 4).showDialog).toBe(false);
    expect(visits(closed, 5).showDialog).toBe(true);
  });

  it('после закрытия — снова через 7 дней, даже на первом визите', () => {
    const closed = dismissInstallPrompt(Date.now());
    jest.advanceTimersByTime(REMIND_AFTER_CLOSE_MS - 1);
    expect(registerVisit(closed, Date.now()).showDialog).toBe(false);
    jest.advanceTimersByTime(1);
    expect(registerVisit(closed, Date.now())).toEqual({
      showDialog: true,
      visitsCountAfterClosing: 1,
      closedTimestamp: closed.closedTimestamp,
    });
  });
});
