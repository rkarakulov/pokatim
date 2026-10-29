import { isNetworkError, apiErrorOf } from '@pokatim/api-client';
import {
  type EventTicketingSettings,
  type EventTicketingUpdate,
  minskWallTimeToUtc,
  TICKETING_INSTRUCTIONS_MAX,
  TicketingInvalidStateDetails,
  utcToMinskWallTime,
} from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { api } from '../../api';
import { fieldErrorText, formFieldOf, serverFieldErrors } from '../../field-errors';
import { formatDateTimeLong } from '../../format';
import { isConflict } from '../../session/errors';
import {
  Banner,
  Button,
  CheckboxField,
  ConflictBanner,
  DateTimeField,
  Dialog,
  ReadonlyField,
  TextAreaField,
  TextField,
} from '../../ui';
import { ticketsKey } from './tickets-query';

interface FormValues {
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  place: string;
  address: string;
  instructions: string;
  capacity: string;
}

/** Окно гонки — подсказка и предупреждение «очный старт вне окна» (RC-T3). */
export interface RaceWindow {
  startsAt: string;
  endsAt: string;
}

const wall = (iso: string | null) => (iso ? utcToMinskWallTime(iso) : '');
const utcOrNull = (value: string) => (value ? minskWallTimeToUtc(value) : null);

function valuesOf(settings: EventTicketingSettings): FormValues {
  return {
    enabled: settings.enabled,
    startsAt: wall(settings.startsAt),
    endsAt: wall(settings.endsAt),
    place: settings.place ?? '',
    address: settings.address ?? '',
    instructions: settings.instructions ?? '',
    capacity: settings.capacity === null ? '' : String(settings.capacity),
  };
}

function requestOf(settings: EventTicketingSettings, values: FormValues): EventTicketingUpdate {
  const common = {
    enabled: values.enabled,
    address: values.address,
    instructions: values.instructions,
    version: settings.version,
  };
  if (settings.kind === 'race') {
    return {
      ...common,
      startsAt: utcOrNull(values.startsAt),
      endsAt: utcOrNull(values.endsAt),
      place: values.place,
    };
  }
  const capacity = values.capacity.trim();
  return { ...common, capacity: capacity === '' ? null : Number(capacity) };
}

/** Текст `409 TICKETING_INVALID_STATE` по причине; незнакомая — общий «не удалось сохранить». */
function invalidStateText(error: unknown): string | undefined {
  const apiError = apiErrorOf(error);
  if (apiError?.code !== 'TICKETING_INVALID_STATE') return undefined;
  const details = TicketingInvalidStateDetails.safeParse(apiError.details);
  return details.success
    ? t(`admin.tickets.invalidState.${details.data.reason}` as MessageKey)
    : t('admin.saveFailed');
}

/**
 * Настройки билетов события (RHF): «Выдавать билеты»; гонка — очный старт (подсказка окна, RC-T3), окончание, место,
 * адрес; календарь — дата и место из старта (только чтение), число мест. Выключение при выпущенных билетах —
 * подтверждение с числом (RC-T6). Ошибки: 400 — под полями, 409 `CONFLICT` — «обновите», 409
 * `TICKETING_INVALID_STATE` — баннер по причине.
 */
export function TicketingSettingsForm({
  settings,
  window,
}: {
  settings: EventTicketingSettings;
  window?: RaceWindow;
}) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [confirming, setConfirming] = useState<FormValues>();
  const form = useForm<FormValues>({ defaultValues: valuesOf(settings) });
  const race = settings.kind === 'race';

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.updateEventTicketing(settings.kind, settings.eventId, requestOf(settings, values)),
    onSuccess: async (next) => {
      queryClient.setQueryData([...ticketsKey(next.kind, next.eventId), 'settings'], next);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => {
      if (isConflict(error)) return setConflict(true);
      const fields = serverFieldErrors(error);
      if (fields?.length) {
        for (const field of fields) {
          form.setError(formFieldOf(field.path) as keyof FormValues, {
            type: 'server',
            message: field.code,
          });
        }
        return;
      }
      setFailure(
        invalidStateText(error) ??
          (isNetworkError(error) ? t('error.network') : t('admin.saveFailed')),
      );
    },
  });

  const submit = (values: FormValues) => {
    setFailure(undefined);
    if (settings.enabled && !values.enabled && settings.activeTickets > 0) {
      setConfirming(values);
      return;
    }
    save.mutate(values);
  };

  const errors = form.formState.errors;
  const errorOf = (field: keyof FormValues) => fieldErrorText(errors[field]?.message);
  const startsAt = useWatch({ control: form.control, name: 'startsAt' });
  const instructions = useWatch({ control: form.control, name: 'instructions' });
  const outsideWindow =
    race &&
    window !== undefined &&
    startsAt !== '' &&
    (Date.parse(minskWallTimeToUtc(startsAt)) < Date.parse(window.startsAt) ||
      Date.parse(minskWallTimeToUtc(startsAt)) >= Date.parse(window.endsAt));

  return (
    <form
      noValidate
      aria-label={t('admin.tickets.section.settings')}
      className="form-stack"
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
    >
      {conflict ? (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            void queryClient.invalidateQueries({
              queryKey: ticketsKey(settings.kind, settings.eventId),
            });
          }}
        />
      ) : null}
      {failure ? (
        <Banner tone="error" role="alert">
          {failure}
        </Banner>
      ) : null}
      <CheckboxField
        label={t('admin.tickets.enabled')}
        help={t('admin.tickets.enabledHelp')}
        {...form.register('enabled')}
      />
      {race ? (
        <>
          <Controller
            control={form.control}
            name="startsAt"
            render={({ field }) => (
              <DateTimeField
                label={t('admin.tickets.startsAt')}
                zoneLabel={t('admin.zone')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errorOf('startsAt')}
                help={
                  window
                    ? t('admin.tickets.startsAtHelp', {
                        from: formatDateTimeLong(window.startsAt),
                        to: formatDateTimeLong(window.endsAt),
                      })
                    : undefined
                }
              />
            )}
          />
          {outsideWindow ? (
            <Banner tone="warning">{t('admin.tickets.startsOutside')}</Banner>
          ) : null}
          <Controller
            control={form.control}
            name="endsAt"
            render={({ field }) => (
              <DateTimeField
                label={t('admin.tickets.endsAt')}
                zoneLabel={t('admin.zone')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errorOf('endsAt')}
              />
            )}
          />
          <TextField
            label={t('admin.tickets.place')}
            autoComplete="off"
            error={errorOf('place')}
            {...form.register('place')}
          />
        </>
      ) : (
        <>
          <ReadonlyField
            label={t('admin.tickets.calendarStart')}
            value={settings.startsAt ? formatDateTimeLong(settings.startsAt) : '—'}
            help={t('admin.tickets.calendarHelp')}
          />
          <ReadonlyField
            label={t('admin.tickets.calendarPlace')}
            value={settings.place ?? '—'}
            help={t('admin.tickets.calendarHelp')}
          />
        </>
      )}
      <TextField
        label={t('admin.tickets.address')}
        autoComplete="off"
        error={errorOf('address')}
        {...form.register('address')}
      />
      {race ? null : (
        <TextField
          label={t('admin.tickets.capacity')}
          type="number"
          min={1}
          inputMode="numeric"
          error={errorOf('capacity')}
          help={t('admin.tickets.registered', { count: settings.registeredCount })}
          {...form.register('capacity')}
        />
      )}
      <TextAreaField
        label={t('admin.tickets.instructions')}
        rows={4}
        maxLength={TICKETING_INSTRUCTIONS_MAX}
        error={errorOf('instructions')}
        help={t('admin.tickets.instructionsCount', {
          count: instructions.length,
          max: TICKETING_INSTRUCTIONS_MAX,
        })}
        {...form.register('instructions')}
      />
      <div className="form-actions">
        <Button type="submit" variant="primary" busy={save.isPending} disabled={save.isPending}>
          {t('admin.tickets.save')}
        </Button>
      </div>
      <Dialog
        open={confirming !== undefined}
        title={t('admin.tickets.disableTitle')}
        onClose={() => setConfirming(undefined)}
      >
        <p className="t-body">
          {t('admin.tickets.disableMessage', { count: settings.activeTickets })}
        </p>
        <div className="form-actions">
          <Button
            variant="danger"
            onClick={() => {
              if (confirming) save.mutate(confirming);
              setConfirming(undefined);
            }}
          >
            {t('admin.tickets.disableConfirm')}
          </Button>
          <Button onClick={() => setConfirming(undefined)}>{t('admin.tickets.cancel')}</Button>
        </div>
      </Dialog>
    </form>
  );
}
