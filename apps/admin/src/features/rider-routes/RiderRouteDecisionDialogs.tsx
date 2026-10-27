import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  ApproveRiderRouteRequest,
  ROUTE_PUBLICATION_COMMENT_MAX,
  ROUTE_REJECTION_REASONS,
  RejectRiderRouteRequest,
  type RiderRouteModerationDetail,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { api } from '../../api';
import { fieldErrorText, serverFieldErrors } from '../../field-errors';
import {
  Banner,
  Button,
  ChipGroup,
  Dialog,
  RadioGroup,
  ReasonDialog,
  SelectField,
  TextAreaField,
} from '../../ui';
import { CITY_OPTIONS, SURFACE_OPTIONS } from '../routes/RouteCatalogDialog';
import { isStaleRiderRoute } from './rider-routes-format';

/** Действие модератора над заявкой (routes-06, A5). */
export type RiderRouteAction = 'approve' | 'reject' | ReasonAction;
/** Действия с причиной в журнал (`ReasonDialog`). */
export type ReasonAction = 'hide' | 'restore' | 'dismiss';

export const ACTION_LABEL = {
  approve: 'admin.riderRoutes.approve',
  reject: 'admin.riderRoutes.reject',
  hide: 'admin.riderRoutes.hide',
  restore: 'admin.riderRoutes.restore',
  dismiss: 'admin.riderRoutes.dismiss',
} as const;

/** Ошибка действия в окне (устаревшая заявка — не здесь: баннер на странице). */
export const actionErrorText = (error: unknown) => {
  if (isNetworkError(error)) return t('error.network');
  return apiErrorOf(error) ? t('admin.saveFailed') : t('error.unknown');
};

/**
 * Окно решения: `onDone` — ответ сервера (карточка после действия); устаревшая заявка (409/404) — `onStale`, окно
 * закрывается.
 */
interface DecisionProps {
  route: RiderRouteModerationDetail;
  onDone: (saved: RiderRouteModerationDetail) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}

/** Общий ход отправки формы окна: ошибки полей сервера — под полями, устаревшая заявка — баннер страницы. */
function useDecision(
  setFieldError: (path: string, code: string) => void,
  { onDone, onStale, onClose }: Omit<DecisionProps, 'route'>,
) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const run = async (send: () => Promise<RiderRouteModerationDetail>) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await onDone(await send());
      onClose();
    } catch (error) {
      if (isStaleRiderRoute(error)) {
        onStale();
        onClose();
        return;
      }
      const fields = serverFieldErrors(error);
      if (fields?.length) {
        for (const field of fields) setFieldError(field.path.split('.')[0] ?? '', field.code);
        return;
      }
      setFailure(actionErrorText(error));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) onClose();
  };
  return { busy, failure, run, close };
}

function Actions({
  busy,
  disabled = false,
  label,
  destructive = false,
  onCancel,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  destructive?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="dialog__actions">
      <Button onClick={onCancel} disabled={busy}>
        {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
      </Button>
      <Button
        type="submit"
        variant={destructive ? 'dangerSolid' : 'primary'}
        disabled={disabled}
        busy={busy}
      >
        {label}
      </Button>
    </div>
  );
}

/** Значения окна «Одобрить»: город — строка выбора (`''` — не выбран), проверка — схема контракта. */
const ApproveForm = z.object({
  city: z.string().pipe(ApproveRiderRouteRequest.shape.city),
  surfaces: ApproveRiderRouteRequest.shape.surfaces,
});
type ApproveFormValues = z.input<typeof ApproveForm>;
type ApproveFormOutput = z.output<typeof ApproveForm>;

/**
 * «Одобрить» (A2): город старта и покрытие из заявки — модератор может поправить; предупреждение, что линия станет
 * публичной. Журнал пишет поправленные поля (`changedFields`) на сервере.
 */
export function ApproveRiderRouteDialog({ route, ...handlers }: DecisionProps) {
  const form = useForm<ApproveFormValues, unknown, ApproveFormOutput>({
    resolver: zodResolver(ApproveForm),
    defaultValues: { city: route.city, surfaces: route.surfaces },
  });
  const { busy, failure, run, close } = useDecision(
    (path, code) =>
      form.setError(path === 'surfaces' ? 'surfaces' : 'city', { type: 'server', message: code }),
    handlers,
  );
  const errors = form.formState.errors;
  return (
    <Dialog
      open
      title={t('admin.riderRoutes.approveTitle', { title: route.title })}
      onClose={close}
    >
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) =>
            run(() => api.approveRiderRoute(route.id, { version: route.version, ...values })),
          )(event)
        }
      >
        <Banner tone="warning">{t('admin.riderRoutes.approveConsequences')}</Banner>
        <Controller
          control={form.control}
          name="city"
          render={({ field }) => (
            <SelectField
              label={t('admin.riderRoutes.field.city')}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
              options={[
                { value: '', label: t('admin.riderRoutes.field.cityPlaceholder') },
                ...CITY_OPTIONS,
              ]}
              error={fieldErrorText(errors.city?.message)}
            />
          )}
        />
        <Controller
          control={form.control}
          name="surfaces"
          render={({ field }) => (
            <ChipGroup
              label={t('admin.riderRoutes.field.surfaces')}
              options={SURFACE_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              error={fieldErrorText(errors.surfaces?.message ?? errors.surfaces?.root?.message)}
            />
          )}
        />
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <Actions busy={busy} label={t('admin.riderRoutes.approve')} onCancel={close} />
      </form>
    </Dialog>
  );
}

/** Значения окна «Отклонить»: причина — справочник (`''` — не выбрана), комментарий автору ≤ 500. */
const RejectForm = z.object({
  reason: z.string().pipe(RejectRiderRouteRequest.shape.reason),
  comment: RejectRiderRouteRequest.shape.comment,
});
type RejectFormValues = z.input<typeof RejectForm>;
type RejectFormOutput = z.output<typeof RejectForm>;

const REJECTION_OPTIONS = ROUTE_REJECTION_REASONS.map((value) => ({
  value,
  label: t(`domain.routeRejectionReason.${value}`),
}));

/**
 * «Отклонить» (U5): причина из справочника обязательна (подтверждение неактивно до выбора), комментарий автору —
 * необязателен; автор увидит и то и другое. В журнал — код причины и комментарий.
 */
export function RejectRiderRouteDialog({ route, ...handlers }: DecisionProps) {
  const form = useForm<RejectFormValues, unknown, RejectFormOutput>({
    resolver: zodResolver(RejectForm),
    defaultValues: { reason: '', comment: '' },
  });
  const { busy, failure, run, close } = useDecision(
    (path, code) =>
      form.setError(path === 'comment' ? 'comment' : 'reason', { type: 'server', message: code }),
    handlers,
  );
  const reason = useWatch({ control: form.control, name: 'reason' });
  const errors = form.formState.errors;
  return (
    <Dialog open title={t('admin.riderRoutes.rejectTitle', { title: route.title })} onClose={close}>
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) =>
            run(() =>
              api.rejectRiderRoute(route.id, {
                version: route.version,
                reason: values.reason,
                ...(values.comment ? { comment: values.comment } : {}),
              }),
            ),
          )(event)
        }
      >
        <p className="dialog__consequences t-body">{t('admin.riderRoutes.rejectConsequences')}</p>
        <Controller
          control={form.control}
          name="reason"
          render={({ field }) => (
            <RadioGroup
              legend={t('admin.riderRoutes.rejectReason')}
              options={REJECTION_OPTIONS}
              value={(field.value || undefined) as (typeof REJECTION_OPTIONS)[number]['value']}
              onChange={field.onChange}
              autoFocusFirst
            />
          )}
        />
        <TextAreaField
          label={t('admin.riderRoutes.rejectComment')}
          help={t('admin.riderRoutes.rejectCommentHint', { max: ROUTE_PUBLICATION_COMMENT_MAX })}
          maxLength={ROUTE_PUBLICATION_COMMENT_MAX}
          error={fieldErrorText(errors.comment?.message, { max: ROUTE_PUBLICATION_COMMENT_MAX })}
          {...form.register('comment')}
        />
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <Actions
          busy={busy}
          disabled={!reason}
          destructive
          label={t('admin.riderRoutes.reject')}
          onCancel={close}
        />
      </form>
    </Dialog>
  );
}

/**
 * «Скрыть» / «Вернуть» / «Отклонить жалобы» — `ReasonDialog` с обязательной причиной (уходит в журнал панели);
 * «Отклонить жалобы» отправляет `reportRevision` карточки (пришла новая жалоба — 409).
 */
export function ReasonDecisionDialog({
  route,
  action,
  onDone,
  onStale,
  onClose,
}: DecisionProps & { action: ReasonAction | undefined }) {
  const send = (reason: string) => {
    const body = { version: route.version, reason };
    if (action === 'hide') return api.hideRiderRoute(route.id, body);
    if (action === 'restore') return api.restoreRiderRoute(route.id, body);
    return api.dismissRiderRouteReports(route.id, {
      ...body,
      reportRevision: route.reportRevision,
    });
  };
  const confirm = async (reason: string) => {
    let saved: RiderRouteModerationDetail;
    try {
      saved = await send(reason);
    } catch (error) {
      if (!isStaleRiderRoute(error)) throw error;
      onStale();
      return;
    }
    await onDone(saved);
  };
  return (
    <ReasonDialog
      open={action !== undefined}
      title={action ? t(`admin.riderRoutes.${action}Title`, { title: route.title }) : ''}
      consequences={action ? t(`admin.riderRoutes.${action}Consequences`) : ''}
      confirmLabel={action ? t(ACTION_LABEL[action]) : ''}
      destructive={action === 'hide'}
      errorText={actionErrorText}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
