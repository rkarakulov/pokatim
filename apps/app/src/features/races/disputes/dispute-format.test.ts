/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';

import {
  against,
  DISPUTE_ID,
  filed,
  myDisputes,
  RIVAL_ENTRY_ID,
} from '../../../__tests__/disputes-fixtures';
import {
  descriptionError,
  disputeDate,
  disputeErrorText,
  disputeStatus,
  inOtherGroup,
  needsDisputePolling,
  responseError,
  rivalAction,
} from './dispute-format';

const OTHER = '0199d000-0000-7000-8000-0000000000f9';

describe('статус спора', () => {
  it.each([
    ['open', 'На рассмотрении', 'warning'],
    ['withdrawn', 'Отозван', 'neutral'],
    ['upheld', 'Удовлетворён', 'neutral'],
    ['rejected', 'Отклонён', 'neutral'],
    ['unknown', 'Статус обновляется', 'neutral'],
  ] as const)('%s — «%s»', (status, label, tone) => {
    expect(disputeStatus(status)).toEqual({ label, tone });
  });
});

describe('дата спора', () => {
  it('по Минску, с годом', () => {
    expect(disputeDate('2026-10-13T09:00:00Z')).toBe('13 октября 2026, 12:00');
  });
});

describe('действие карточки соперника (RC-14, M1)', () => {
  it('open без моего спора — «Оспорить результат» до отсечки', () => {
    expect(rivalAction(myDisputes(), RIVAL_ENTRY_ID)).toEqual({
      kind: 'file',
      note: 'Споры принимаются до 13 октября 2026, 12:00',
    });
  });

  it('closed по сроку — выключенное с датой протокола; по лимиту — причина', () => {
    expect(
      rivalAction(myDisputes({ status: 'closed', reason: 'filing_closed' }), RIVAL_ENTRY_ID),
    ).toEqual({
      kind: 'closed',
      note: 'Приём споров закрыт — протокол будет опубликован 14 октября 2026, 12:00',
    });
    expect(
      rivalAction(myDisputes({ status: 'closed', reason: 'open_limit' }), RIVAL_ENTRY_ID),
    ).toEqual({ kind: 'closed', note: 'У вас уже 3 открытых спора в этой гонке' });
  });

  it('unavailable и unknown — без действия', () => {
    expect(
      rivalAction(myDisputes({ status: 'unavailable', reason: 'not_entered' }), RIVAL_ENTRY_ID),
    ).toBeNull();
    expect(rivalAction(myDisputes({ status: 'unknown', reason: null }), RIVAL_ENTRY_ID)).toBeNull();
  });

  it('мой спор по строке — его статус вместо действия', () => {
    const data = myDisputes({}, { filed: [filed()] });
    expect(rivalAction(data, RIVAL_ENTRY_ID)).toEqual({ kind: 'mine', dispute: filed() });
    expect(rivalAction(data, OTHER)).toMatchObject({ kind: 'file' });
  });
});

describe('цель в чужой группе зачёта (race-results-07c)', () => {
  it('разные известные группы — чужая; своя или неизвестная — решает сервер', () => {
    expect(inOtherGroup('w_u40', 'm_u40')).toBe(true);
    expect(inOtherGroup('w_u40', 'w_u40')).toBe(false);
    expect(inOtherGroup(null, 'm_u40')).toBe(false);
    expect(inOtherGroup(undefined, 'm_u40')).toBe(false);
    expect(inOtherGroup('unknown', 'm_u40')).toBe(false);
    expect(inOtherGroup('w_u40', 'unknown')).toBe(false);
    expect(inOtherGroup('w_u40', undefined)).toBe(false);
  });

  it('чужая группа — подача не предлагается (ни open, ни closed); мой спор — статус', () => {
    expect(rivalAction(myDisputes(), RIVAL_ENTRY_ID, true)).toBeNull();
    expect(
      rivalAction(myDisputes({ status: 'closed', reason: 'open_limit' }), RIVAL_ENTRY_ID, true),
    ).toBeNull();
    const data = myDisputes({}, { filed: [filed()] });
    expect(rivalAction(data, RIVAL_ENTRY_ID, true)).toEqual({ kind: 'mine', dispute: filed() });
  });
});

describe('опрос споров (RC-14)', () => {
  it('только пока есть открытый спор', () => {
    expect(needsDisputePolling(myDisputes())).toBe(false);
    expect(needsDisputePolling(myDisputes({}, { filed: [filed()] }))).toBe(true);
    expect(needsDisputePolling(myDisputes({}, { against: [against()] }))).toBe(true);
    expect(needsDisputePolling(myDisputes({}, { filed: [filed({ status: 'withdrawn' })] }))).toBe(
      false,
    );
    expect(needsDisputePolling(null)).toBe(false);
  });
});

describe('ошибки полей', () => {
  it('описание: пусто — можно, больше 2000 — ошибка', () => {
    expect(descriptionError('')).toBeUndefined();
    expect(descriptionError('x'.repeat(2000))).toBeUndefined();
    expect(descriptionError('x'.repeat(2001))).toBe('Слишком длинное значение.');
  });

  it('ответ: пусто — без ошибки (кнопка выключена), короче 3 — ошибка с минимумом', () => {
    expect(responseError('')).toBeUndefined();
    expect(responseError('ok')).toBe('Не короче 3 символов.');
    expect(responseError('Трек мой')).toBeUndefined();
    expect(responseError('x'.repeat(2001))).toBe('Слишком длинное значение.');
  });
});

describe('ошибки действий со спором', () => {
  const blocked = (reason?: string) =>
    new ApiHttpError(409, {
      code: 'DISPUTE_ACTION_BLOCKED',
      message: 'x',
      ...(reason ? { details: { reason } } : {}),
    });

  it('409 по details.reason; незнакомая или без details — общий текст спора', () => {
    expect(disputeErrorText(blocked('already_filed'))).toBe(
      'Вы уже подавали спор по этому результату',
    );
    expect(disputeErrorText(blocked('filing_closed'))).toBe('Приём споров закрыт');
    expect(disputeErrorText(blocked('brand_new'))).toBe('Действие со спором недоступно');
    expect(disputeErrorText(blocked())).toBe('Действие со спором недоступно');
  });

  it('404 DISPUTE_NOT_FOUND, сеть', () => {
    expect(
      disputeErrorText(new ApiHttpError(404, { code: 'DISPUTE_NOT_FOUND', message: 'x' })),
    ).toBe('Спор не найден');
    expect(disputeErrorText(new ApiNetworkError(new TypeError('offline')))).toBe(
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    );
  });

  it('id спора в фикстурах — валидный', () => {
    expect(DISPUTE_ID).toMatch(/^[0-9a-f-]{36}$/);
  });
});
