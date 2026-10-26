/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import {
  actions,
  attempt,
  corridorRace,
  myEntry,
  result,
  row,
} from '../../__tests__/races-fixtures';
import {
  addAttemptBlockReason,
  attemptView,
  blockReasonText,
  enterBlockReason,
  guestCanSeeEnter,
  needsPolling,
  pendingUploadText,
  raceActionErrorText,
  resultBanner,
  resultElapsed,
  resultPill,
  resultRow,
  resultSignature,
  showsResultsTable,
} from './participation-format';

const PROTOCOL = '14 октября';
const UPLOAD = '0199c000-0000-7000-8000-000000000001';

describe('причины недоступности — по подмножеству действия (F1)', () => {
  it('попытка: [window_closed, upload_closed] → upload_closed (reasons[0] дал бы «Окно закрыто»)', () => {
    const reasons = actions({ reasons: ['window_closed', 'upload_closed'] });
    expect(reasons.reasons[0]).toBe('window_closed');
    expect(addAttemptBlockReason(reasons)).toBe('upload_closed');
    expect(blockReasonText('upload_closed')).toBe('Срок загрузки заездов истёк');
  });

  it('попытка: cancelled, window_not_open, attempt_limit, unknown; своих причин нет — null', () => {
    expect(addAttemptBlockReason(actions({ reasons: ['cancelled'] }))).toBe('cancelled');
    expect(addAttemptBlockReason(actions({ reasons: ['window_not_open'] }))).toBe(
      'window_not_open',
    );
    expect(addAttemptBlockReason(actions({ reasons: ['attempt_limit'] }))).toBe('attempt_limit');
    expect(addAttemptBlockReason(actions({ reasons: ['unknown'] }))).toBe('unknown');
    expect(addAttemptBlockReason(actions({ reasons: ['window_closed'] }))).toBeNull();
  });

  it('unknown не перебивает свою причину: [unknown, upload_closed] → upload_closed', () => {
    expect(addAttemptBlockReason(actions({ reasons: ['unknown', 'upload_closed'] }))).toBe(
      'upload_closed',
    );
    expect(enterBlockReason(actions({ reasons: ['unknown', 'entries_closed'] }))).toBe(
      'entries_closed',
    );
  });

  it('заявка: [no_corridor, not_entered] → no_corridor; [unknown] → unknown; [not_entered] → null', () => {
    expect(enterBlockReason(actions({ reasons: ['no_corridor', 'not_entered'] }))).toBe(
      'no_corridor',
    );
    expect(enterBlockReason(actions({ reasons: ['entries_closed', 'not_entered'] }))).toBe(
      'entries_closed',
    );
    expect(enterBlockReason(actions({ reasons: ['unknown'] }))).toBe('unknown');
    expect(enterBlockReason(actions({ reasons: ['not_entered'] }))).toBeNull();
    expect(blockReasonText('unknown')).toBe('Действие недоступно');
  });
});

describe('показ кнопки гостя и таблицы — по фазе сервера и коридору', () => {
  it.each([
    ['upcoming', true, false],
    ['open', true, true],
    ['closed', false, true],
    ['final', false, true],
    ['cancelled', false, false],
    ['unknown', false, false],
  ] as const)('фаза %s: гость — %s, таблица — %s', (phase, guest, table) => {
    expect(guestCanSeeEnter(corridorRace({ phase }))).toBe(guest);
    expect(showsResultsTable(corridorRace({ phase }))).toBe(table);
  });

  it('без коридора (null или нет поля) — ни кнопки, ни таблицы', () => {
    const { corridor: _omit, ...noField } = corridorRace();
    for (const race of [corridorRace({ corridor: null }), noField]) {
      expect(guestCanSeeEnter(race)).toBe(false);
      expect(showsResultsTable(race)).toBe(false);
    }
  });
});

describe('результат → показ (§7.2)', () => {
  it.each([
    ['none', 'Нет заездов', 'neutral'],
    ['pending', 'Проверка трека', 'warning'],
    ['provisional', 'Предварительный', 'neutral'],
    ['not_counted', 'Не засчитано', 'error'],
    ['dns', 'Не стартовал', 'neutral'],
    ['unknown', '—', 'neutral'],
  ] as const)('плашка %s — «%s» (%s)', (status, label, tone) => {
    expect(resultPill(status)).toEqual({ label, tone });
  });

  it('withdrawn — без плашки (блок отмены)', () => {
    expect(resultPill('withdrawn')).toBeNull();
  });

  it('«Ваше время»: provisional и unknown со временем; pending и прочие — нет (D-37)', () => {
    expect(resultElapsed(result({ status: 'provisional', elapsedSec: 3725 }))).toBe('1:02:05');
    expect(resultElapsed(result({ status: 'unknown', elapsedSec: 60 }))).toBe('0:01:00');
    expect(resultElapsed(result({ status: 'unknown', elapsedSec: null }))).toBeNull();
    expect(resultElapsed(result({ status: 'final', elapsedSec: 3725 }))).toBe('1:02:05');
    expect(resultElapsed(result({ status: 'dq', elapsedSec: 3725 }))).toBe('1:02:05');
    expect(resultElapsed(result({ status: 'pending', elapsedSec: 3725 }))).toBeNull();
    expect(resultElapsed(result({ status: 'not_counted', elapsedSec: 3725 }))).toBeNull();
  });

  it('баннер: pending — «Место появится после проверки.», warning', () => {
    expect(resultBanner(result({ status: 'pending' }), PROTOCOL)).toEqual({
      tone: 'warning',
      message: 'Место появится после проверки.',
    });
  });

  it('баннер provisional: место, ничья, без места — info', () => {
    expect(
      resultBanner(result({ status: 'provisional', elapsedSec: 1, place: 3 }), PROTOCOL),
    ).toEqual({
      tone: 'info',
      message: 'Предварительно 3-е место до публикации протокола 14 октября.',
    });
    expect(
      resultBanner(
        result({ status: 'provisional', elapsedSec: 1, place: 2, tied: true }),
        PROTOCOL,
      ),
    ).toEqual({
      tone: 'info',
      message: 'Предварительно 2-е место (поровну с другими) до публикации протокола 14 октября.',
    });
    expect(resultBanner(result({ status: 'provisional', elapsedSec: 1 }), PROTOCOL)).toEqual({
      tone: 'info',
      message: 'Результат предварительный до публикации протокола 14 октября.',
    });
  });

  it.each(['none', 'not_counted', 'dns', 'withdrawn', 'unknown'] as const)(
    'баннер %s — нет',
    (status) => {
      expect(resultBanner(result({ status, place: 1 }), PROTOCOL)).toBeNull();
    },
  );
});

describe('попытки', () => {
  it('засчитана и лучшая: время сегмента, «Лучший», источник и происхождение', () => {
    expect(attemptView(attempt())).toEqual({
      status: 'Засчитано',
      tone: 'success',
      origin: 'Загружен в гонку',
      source: 'Файл',
      time: '1:42:05',
      best: true,
      detail: null,
    });
  });

  it('отказ: причина по первой; незнакомая причина — нейтрально', () => {
    const rejected = attemptView(
      attempt({
        status: 'rejected',
        reasons: ['off_corridor', 'gps_gap'],
        segment: null,
        isBest: false,
      }),
    );
    expect(rejected).toMatchObject({
      status: 'Не засчитано',
      tone: 'error',
      time: null,
      best: false,
      detail: 'Сход с коридора: больше 2 % вне коридора или выход длиннее 500 м',
    });
    expect(
      attemptView(attempt({ status: 'rejected', reasons: ['unknown'], segment: null })).detail,
    ).toBe('Не засчитано');
    expect(attemptView(attempt({ status: 'rejected', reasons: [], segment: null })).detail).toBe(
      'Не засчитано',
    );
  });

  it('сбой проверки — подсказка; происхождение unknown — без подписи; Garmin', () => {
    const failed = attemptView(
      attempt({
        status: 'failed',
        origin: 'unknown',
        segment: null,
        isBest: false,
        activity: { ...attempt().activity, source: 'garmin' },
      }),
    );
    expect(failed).toMatchObject({
      status: 'Не удалось проверить',
      origin: null,
      source: 'Garmin',
      time: null,
      detail: 'Не удалось проверить трек — команда платформы разберётся.',
    });
  });

  it('в проверке и незнакомый статус — без времени и «Лучший»; источник unknown — «Файл»', () => {
    expect(
      attemptView(attempt({ status: 'checking', segment: null, isBest: false })),
    ).toMatchObject({ status: 'Проверка трека', time: null, best: false, detail: null });
    expect(
      attemptView(
        attempt({
          status: 'unknown',
          isBest: true,
          activity: { ...attempt().activity, source: 'unknown' },
        }),
      ),
    ).toMatchObject({ status: '—', tone: 'neutral', time: null, best: false, source: 'Файл' });
  });

  it('незавершённые загрузки: обработка, отказ с причиной, готово — без строки', () => {
    expect(pendingUploadText({ uploadId: UPLOAD, status: 'queued', failure: null })).toBe(
      'Файл обрабатывается…',
    );
    expect(pendingUploadText({ uploadId: UPLOAD, status: 'unknown', failure: null })).toBe(
      'Файл обрабатывается…',
    );
    expect(pendingUploadText({ uploadId: UPLOAD, status: 'failed', failure: 'no_track' })).toBe(
      'Файл не принят: В файле нет трека',
    );
    expect(pendingUploadText({ uploadId: UPLOAD, status: 'duplicate', failure: null })).toBe(
      'Файл не принят: Такой заезд уже есть',
    );
    expect(pendingUploadText({ uploadId: UPLOAD, status: 'ready', failure: null })).toBeNull();
  });
});

describe('polling и подпись результата (§7.3, F13)', () => {
  it('опрос: попытка queued/checking, незавершённая загрузка, результат pending', () => {
    expect(needsPolling(myEntry({ attempts: [attempt({ status: 'queued' })] }))).toBe(true);
    expect(needsPolling(myEntry({ attempts: [attempt({ status: 'checking' })] }))).toBe(true);
    expect(
      needsPolling(
        myEntry({ pendingUploads: [{ uploadId: UPLOAD, status: 'processing', failure: null }] }),
      ),
    ).toBe(true);
    expect(needsPolling(myEntry({ result: result({ status: 'pending' }) }))).toBe(true);
  });

  it('всё готово, нет данных — без опроса', () => {
    expect(
      needsPolling(
        myEntry({
          attempts: [attempt(), attempt({ status: 'rejected' })],
          pendingUploads: [{ uploadId: UPLOAD, status: 'failed', failure: null }],
          result: result({ status: 'provisional', elapsedSec: 1, place: 1 }),
        }),
      ),
    ).toBe(false);
    expect(needsPolling(null)).toBe(false);
    expect(needsPolling(undefined)).toBe(false);
  });

  it('подпись: статус, место, ничья, время; нет данных — null', () => {
    const base = myEntry({ result: result({ status: 'pending' }) });
    const placed = myEntry({
      result: result({ status: 'provisional', elapsedSec: 100, place: 2 }),
    });
    expect(resultSignature(base)).not.toBe(resultSignature(placed));
    expect(resultSignature(placed)).toBe(resultSignature(myEntry({ ...placed })));
    expect(
      resultSignature(
        myEntry({
          result: result({ status: 'provisional', elapsedSec: 100, place: 2, tied: true }),
        }),
      ),
    ).not.toBe(resultSignature(placed));
    expect(resultSignature(null)).toBeNull();
    expect(resultSignature(undefined)).toBeNull();
  });
});

describe('тексты ошибок действий (F5)', () => {
  it.each([
    ['RACE_ENTRY_CLOSED', 'Приём заявок на гонку закрыт'],
    ['RACE_ENTRY_WITHDRAWN', 'Участие в этой гонке уже отменено'],
    ['RACE_ENTRY_REQUIRED', 'Сначала заявитесь на гонку'],
    ['RACE_WITHDRAW_CLOSED', 'Отменить участие можно, пока окно открыто'],
    ['ATTEMPT_UPLOAD_CLOSED', 'Срок загрузки заездов истёк'],
    ['ATTEMPT_LIMIT', 'Достигнут предел заездов для гонки'],
    ['ATTEMPT_SOURCE_INVALID', 'Этот заезд нельзя добавить в гонку'],
  ])('%s — «%s»', (code, text) => {
    expect(raceActionErrorText(new ApiHttpError(409, { code, message: 'x' }))).toBe(text);
  });

  it('сеть, 429, прочее — общий текст действия', () => {
    expect(raceActionErrorText(new ApiNetworkError(new TypeError('Network request failed')))).toBe(
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    );
    expect(
      raceActionErrorText(
        new ApiHttpError(429, {
          code: 'RATE_LIMITED',
          message: 'x',
          details: { retryAfterSec: 30 },
        }),
      ),
    ).toBe('Слишком много попыток. Попробуйте позже.');
    expect(raceActionErrorText(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))).toBe(
      'Что-то пошло не так. Попробуйте ещё раз.',
    );
  });
});

describe('строка таблицы', () => {
  it('место, «Участник», время, a11y', () => {
    expect(resultRow(row({ place: 3, elapsedSec: 3725 }), false)).toEqual({
      place: '3',
      who: 'Участник',
      time: '1:02:05',
      a11y: '3, Участник, 1:02:05',
    });
  });

  it('ничья «=2» и своя строка «Вы»; a11y — «2-е место поровну»', () => {
    expect(resultRow(row({ place: 2, tied: true, elapsedSec: 5400 }), true)).toEqual({
      place: '=2',
      who: 'Вы',
      time: '1:30:00',
      a11y: '2-е место поровну, Вы, 1:30:00',
    });
  });

  it('чужая строка с именем — имя и a11y с именем; своя с именем — «Вы» (AC8)', () => {
    expect(resultRow(row({ place: 1, elapsedSec: 3600, riderName: 'Анна К.' }), false)).toEqual({
      place: '1',
      who: 'Анна К.',
      time: '1:00:00',
      a11y: '1, Анна К., 1:00:00',
    });
    expect(resultRow(row({ riderName: 'Анна К.' }), true).who).toBe('Вы');
  });
});
