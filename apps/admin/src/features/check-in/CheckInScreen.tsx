import { isNetworkError } from '@pokatim/api-client';
import {
  type CheckInOutcome,
  type CheckInRequest,
  type CheckInView,
  formatTicketCode,
  TicketCode,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { api } from '../../api';
import { fieldErrorText } from '../../field-errors';
import { formatDateTime, formatDateTimeLong } from '../../format';
import { httpStatus } from '../../session/errors';
import { Banner, Button, ReadonlyField, TextField } from '../../ui';
import { formatCategory } from '../tickets/tickets-query';
import { QrScanner } from './QrScanner';
import { createDedup, parseScan } from './scanner';

const OUTCOME_TONE: Record<CheckInOutcome, 'neutral' | 'warning' | 'error'> = {
  ready: 'neutral',
  checked_in: 'neutral',
  already_checked_in: 'warning',
  cancelled: 'error',
  event_cancelled: 'error',
  outside_window: 'warning',
};

function outcomeText(view: CheckInView): string {
  const at = view.ticket.checkedInAt ? formatDateTime(view.ticket.checkedInAt) : '';
  switch (view.outcome) {
    case 'checked_in':
      return t('admin.checkIn.outcome.checked_in', { time: at });
    case 'already_checked_in':
      return t('admin.checkIn.outcome.already_checked_in', {
        time: at,
        by: view.ticket.checkedInBy ?? '—',
      });
    default:
      return t(`admin.checkIn.outcome.${view.outcome}`);
  }
}

/** Отказ запроса нейтральным текстом: 404 не различает «нет билета» и «чужое событие». */
function errorText(error: unknown): string {
  const status = httpStatus(error);
  if (status === 404) return t('admin.checkIn.notFound');
  if (status === 403) return t('admin.checkIn.forbidden');
  if (status === 429) return t('admin.checkIn.rateLimited');
  return isNetworkError(error) ? t('error.network') : t('admin.checkIn.failed');
}

function ResultCard({
  view,
  marking,
  onMark,
  onNext,
}: {
  view: CheckInView;
  marking: boolean;
  onMark: () => void;
  onNext: () => void;
}) {
  const { ticket } = view;
  return (
    <div className="check-in__card form-stack">
      <Banner tone={OUTCOME_TONE[view.outcome]} title={outcomeText(view)}>
        {formatTicketCode(ticket.code)}
      </Banner>
      <ReadonlyField label={t('admin.checkIn.card.event')} value={ticket.event.title} />
      <ReadonlyField
        label={t('admin.checkIn.card.date')}
        value={formatDateTimeLong(ticket.event.startsAt)}
      />
      <ReadonlyField label={t('admin.checkIn.card.participant')} value={ticket.participantName} />
      {ticket.category ? (
        <ReadonlyField
          label={t('admin.checkIn.card.category')}
          value={formatCategory(ticket.category)}
        />
      ) : null}
      <div className="form-actions">
        {view.outcome === 'ready' ? (
          <Button variant="primary" busy={marking} disabled={marking} onClick={onMark}>
            {t('admin.checkIn.mark')}
          </Button>
        ) : null}
        {/* до ответа отметки «Следующий» недоступен: поздний ответ иначе вернул бы сброшенную карточку */}
        <Button disabled={marking} onClick={onNext}>
          {t('admin.checkIn.next')}
        </Button>
      </div>
    </div>
  );
}

/**
 * «Check-in» (event-tickets PR C, RC-C2): отдельный layout без сайдбара, от 360 px — камера (QR) и ввод кода.
 * Скан/код → проверка (`lookup`) → карточка → «Отметить» (только `ready`) → итог. Чужой QR — «Это не билет» без
 * запроса; тот же QR в течение 5 с — без запроса; во время запроса и показа карточки распознавание на паузе. Итог
 * объявляется (`role="status"`). Источник истины — сервер (право, окно, повтор).
 */
export function CheckInScreen() {
  // карточка вместе с запросом, который её получил: «Отметить» шлёт именно его, а не последний отправленный
  const [shown, setShown] = useState<{ view: CheckInView; request: CheckInRequest }>();
  const view = shown?.view;
  const [failure, setFailure] = useState<string>();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  // поколение операции: новый поиск и «Следующий» делают ответы прежних запросов устаревшими
  const generation = useRef(0);
  const dedup = useRef(createDedup());

  const lookup = useMutation({
    mutationFn: (body: CheckInRequest) => api.lookupTicket(body),
  });
  const mark = useMutation({
    mutationFn: (body: CheckInRequest) => api.checkInTicket(body),
  });

  const handlers = (request: CheckInRequest) => {
    const current = generation.current;
    return {
      onSuccess: (result: CheckInView) => {
        if (current === generation.current) setShown({ view: result, request });
      },
      onError: (error: unknown) => {
        if (current === generation.current) setFailure(errorText(error));
      },
    };
  };
  const find = (body: CheckInRequest) => {
    generation.current += 1;
    setShown(undefined);
    setFailure(undefined);
    lookup.mutate(body, handlers(body));
  };
  const next = () => {
    generation.current += 1;
    setShown(undefined);
    setFailure(undefined);
    setCode('');
  };
  const onScan = (raw: string) => {
    if (!dedup.current(raw)) return;
    const scan = parseScan(raw);
    if (scan.kind === 'foreign') {
      generation.current += 1;
      setShown(undefined);
      setFailure(t('admin.checkIn.notTicket'));
      return;
    }
    find({ qr: scan.qr });
  };
  const busy = lookup.isPending || mark.isPending;

  return (
    <div className="check-in">
      <header className="check-in__head">
        <Link className="link t-panel-crumb" to="/">
          {t('admin.checkIn.back')}
        </Link>
        <h1 className="t-panel-title">{t('admin.checkIn.title')}</h1>
        <p className="muted t-meta">{t('admin.checkIn.lead')}</p>
      </header>
      <div className="check-in__columns">
        <div className="check-in__input form-stack">
          <QrScanner paused={busy || view !== undefined || failure !== undefined} onScan={onScan} />
          <form
            noValidate
            className="form-stack"
            aria-label={t('admin.checkIn.code')}
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = TicketCode.safeParse(code);
              if (!parsed.success) {
                setCodeError(fieldErrorText(parsed.error.issues[0]?.message ?? 'INVALID'));
                return;
              }
              setCodeError(undefined);
              find({ code: parsed.data });
            }}
          >
            <TextField
              label={t('admin.checkIn.code')}
              help={t('admin.checkIn.codeHelp')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              error={codeError}
              onChange={(event) => setCode(event.target.value)}
            />
            <div className="form-actions">
              <Button type="submit" busy={lookup.isPending} disabled={busy}>
                {t('admin.checkIn.find')}
              </Button>
            </div>
          </form>
        </div>
        <div
          className="check-in__result"
          role="status"
          aria-live="polite"
          aria-label={t('admin.checkIn.result')}
        >
          {failure ? (
            <div className="form-stack">
              <Banner tone="error">{failure}</Banner>
              <div className="form-actions">
                <Button onClick={next}>{t('admin.checkIn.next')}</Button>
              </div>
            </div>
          ) : null}
          {shown ? (
            <ResultCard
              view={shown.view}
              marking={mark.isPending}
              onMark={() => {
                setFailure(undefined);
                mark.mutate(shown.request, handlers(shown.request));
              }}
              onNext={next}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
