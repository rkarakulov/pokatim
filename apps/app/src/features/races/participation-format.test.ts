/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import {
  actions,
  attempt,
  corridorRace,
  finisher,
  myEntry,
  noEntry,
  noEntryTiers,
  result,
  row,
  startEntry,
  verifiedState,
} from '../../__tests__/races-fixtures';
import {
  addAttemptBlockReason,
  attemptView,
  blockReasonText,
  enterBlockReason,
  entryTierLine,
  finisherRow,
  groupChoices,
  groupLabel,
  guestCanSeeEnter,
  offersTierChoice,
  needsPolling,
  pendingUploadText,
  raceActionErrorText,
  resultBanner,
  resultElapsed,
  resultPill,
  resultRow,
  resultSignature,
  showsResultsTable,
  withdrawBlockReason,
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

describe('споры: D-39 и DQ (race-results-06, RC-4, RC-6)', () => {
  it('попытка: dispute_open и disqualified — свои причины с текстом', () => {
    expect(addAttemptBlockReason(actions({ reasons: ['dispute_open'] }))).toBe('dispute_open');
    expect(blockReasonText('dispute_open')).toBe(
      'По результату открыт спор — новые заезды можно загрузить после решения',
    );
    expect(addAttemptBlockReason(actions({ reasons: ['disqualified'] }))).toBe('disqualified');
  });

  it('отмена участия: только dispute_open / disqualified; закрытое окно и unknown — без текста', () => {
    expect(withdrawBlockReason(actions({ reasons: ['dispute_open'] }))).toBe(
      'Отменить участие можно после решения по спору',
    );
    expect(withdrawBlockReason(actions({ reasons: ['disqualified'] }))).toBe(
      'Результат дисквалифицирован по решению команды платформы',
    );
    expect(withdrawBlockReason(actions({ reasons: ['window_closed', 'unknown'] }))).toBeNull();
    expect(
      withdrawBlockReason(actions({ canWithdraw: true, reasons: ['dispute_open'] })),
    ).toBeNull();
  });

  it('409 по details.reason: отмена — races.withdrawBlock, попытка — races.block', () => {
    const blocked = (code: string, reason: string) =>
      new ApiHttpError(409, { code, message: 'x', details: { reason } });
    expect(raceActionErrorText(blocked('RACE_WITHDRAW_CLOSED', 'dispute_open'))).toBe(
      'Отменить участие можно после решения по спору',
    );
    expect(raceActionErrorText(blocked('RACE_WITHDRAW_CLOSED', 'something_new'))).toBe(
      'Отменить участие сейчас нельзя',
    );
    expect(raceActionErrorText(blocked('ATTEMPT_UPLOAD_CLOSED', 'dispute_open'))).toBe(
      'По результату открыт спор — новые заезды можно загрузить после решения',
    );
    expect(raceActionErrorText(blocked('ATTEMPT_UPLOAD_CLOSED', 'attempt_limit'))).toBe(
      'Достигнут предел заездов для гонки',
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
      profileA11y: null,
    });
  });

  it('ничья «=2» и своя строка «Вы»; a11y — «2-е место поровну»', () => {
    expect(resultRow(row({ place: 2, tied: true, elapsedSec: 5400 }), true)).toEqual({
      place: '=2',
      who: 'Вы',
      time: '1:30:00',
      a11y: '2-е место поровну, Вы, 1:30:00',
      profileA11y: null,
    });
  });

  it('чужая строка с именем — имя и a11y с именем; своя с именем — «Вы» (AC8)', () => {
    expect(resultRow(row({ place: 1, elapsedSec: 3600, riderName: 'Анна К.' }), false)).toEqual({
      place: '1',
      who: 'Анна К.',
      time: '1:00:00',
      a11y: '1, Анна К., 1:00:00',
      profileA11y: null,
    });
    expect(resultRow(row({ riderName: 'Анна К.' }), true).who).toBe('Вы');
  });

  it('публичный райдер (rider-links-in-tables) — метка ссылки «Профиль райдера, имя»; своя — тоже по имени', () => {
    const named = row({
      place: 2,
      tied: true,
      elapsedSec: 3600,
      riderName: 'Анна К.',
      riderPublicId: 'p'.repeat(43),
    });
    expect(resultRow(named, false).profileA11y).toBe(
      'Профиль райдера, Анна К., 2-е место поровну, 1:00:00',
    );
    expect(resultRow(named, true).profileA11y).toBe(
      'Профиль райдера, Анна К., 2-е место поровну, 1:00:00',
    );
  });
});

describe('уровни и группы (race-results-07c)', () => {
  it('выбор уровня — только gender_age с блоком verified (DV-1, старый API)', () => {
    expect(offersTierChoice(noEntryTiers())).toBe(true);
    expect(offersTierChoice(noEntry())).toBe(false);
    expect(offersTierChoice(noEntryTiers({ verified: null }))).toBe(false);
    expect(offersTierChoice(noEntryTiers({ groupScheme: 'unknown' }))).toBe(false);
  });

  it('группы — из groupOptions сервера, незнакомые отброшены; анкеты нет — null', () => {
    expect(groupChoices(noEntryTiers())).toEqual(['m_40_49', 'm_u40']);
    expect(
      groupChoices(
        noEntryTiers({ verified: verifiedState({ groupOptions: ['m_50p', 'unknown', 'm_u40'] }) }),
      ),
    ).toEqual(['m_50p', 'm_u40']);
    expect(
      groupChoices(
        noEntryTiers({
          verified: verifiedState({ profileReady: false, ownGroup: null, groupOptions: null }),
        }),
      ),
    ).toBeNull();
  });

  it('строка уровня: Verified · группа; START; схема overall — нет', () => {
    expect(
      entryTierLine(
        startEntry({ entry: { ...startEntry().entry!, tier: 'verified', groupKey: 'w_50p' } }),
      ),
    ).toBe('Verified · Женщины 50+');
    expect(entryTierLine(startEntry())).toBe('START');
    expect(entryTierLine(myEntry())).toBeNull();
    expect(groupLabel('unknown')).toBe('Группа');
  });

  it('finisher: время есть, баннер — почему без места', () => {
    const start = result({ status: 'finisher', elapsedSec: 6125, unranked: 'start' });
    expect(resultElapsed(start)).toBe('1:42:05');
    expect(resultBanner(start, PROTOCOL)?.message).toBe('Уровень START: время без места в зачёте.');
    expect(resultBanner({ ...start, unranked: 'no_heart_rate' }, PROTOCOL)?.message).toBe(
      'Без пульса — вне зачёта. Место в группе — только с пульсом в треке.',
    );
    expect(resultBanner({ ...start, unranked: null }, PROTOCOL)?.message).toBe(
      'Время без места в зачёте.',
    );
  });

  it('место в группе; ничья в группе', () => {
    const placed = result({ status: 'provisional', place: 2, elapsedSec: 6125, group: 'm_u40' });
    expect(resultBanner(placed, PROTOCOL)?.message).toBe(
      'Предварительно 2-е место в группе «Мужчины до 40» до публикации протокола 14 октября.',
    );
    expect(resultBanner({ ...placed, tied: true }, PROTOCOL)?.message).toBe(
      'Предварительно 2-е место (поровну с другими) в группе «Мужчины до 40» до публикации протокола 14 октября.',
    );
  });

  it('подпись результата меняется со сменой группы и причины без места', () => {
    const base = myEntry({
      result: result({ status: 'finisher', elapsedSec: 6125, unranked: 'start' }),
    });
    expect(resultSignature(base)).not.toBe(
      resultSignature(myEntry({ result: { ...base.result, unranked: 'no_heart_rate' } })),
    );
    expect(resultSignature(base)).not.toBe(
      resultSignature(myEntry({ result: { ...base.result, group: 'm_u40' } })),
    );
  });

  it('новые коды заявки — текст по коду', () => {
    expect(
      raceActionErrorText(
        new ApiHttpError(409, { code: 'VERIFIED_PROFILE_REQUIRED', message: 'x' }),
      ),
    ).toBe('Для Verified заполните анкету зачёта');
  });

  it('строка финишёров: без места, «Вы» для своей', () => {
    expect(finisherRow(finisher({ riderName: 'Пётр' }), false)).toEqual({
      who: 'Пётр',
      time: '2:00:00',
      note: 'Финишёр',
      a11y: 'Пётр, 2:00:00, Финишёр',
      profileA11y: null,
    });
    expect(
      finisherRow(finisher({ riderName: 'Пётр', riderPublicId: 'p'.repeat(43) }), false)
        .profileA11y,
    ).toBe('Профиль райдера, Пётр, 2:00:00, Финишёр');
    expect(finisherRow(finisher({ unranked: 'unknown' }), true).who).toBe('Вы');
    expect(finisherRow(finisher({ unranked: 'unknown' }), true).note).toBe('Без места');
  });
});
