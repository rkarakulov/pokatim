import { isNetworkError, apiErrorOf } from '@pokatim/api-client';
import {
  EVENT_REMINDER_TEXT_MAX,
  EVENT_REMINDERS_MAX,
  type EventTicketingSettings,
  type EventTicketingUpdate,
  minskWallTimeToUtc,
  TICKETING_INSTRUCTIONS_MAX,
  TicketingInvalidStateDetails,
  utcToMinskWallTime,
} from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
  Controller,
  type Path,
  type UseFormReturn,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form';

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
  DisabledReason,
  ReadonlyField,
  SelectField,
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
  reminders: ReminderRow[];
}

/** Строка правила напоминания: `id` — у сохранённого правила (без него сервер создаст новое). */
interface ReminderRow {
  id?: string;
  offsetHours: string;
  text: string;
}

/** Варианты «за сколько» (ч); правило с другим offset (API) показывается своим вариантом. */
const REMINDER_OFFSETS = [1, 2, 3, 6, 12, 24, 48, 72, 168];

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
    reminders: settings.reminders.map((rule) => ({
      id: rule.id,
      offsetHours: String(rule.offsetHours),
      text: rule.text,
    })),
  };
}

const remindersOf = (rows: ReminderRow[]): NonNullable<EventTicketingUpdate['reminders']> =>
  rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    offsetHours: Number(row.offsetHours),
    text: row.text,
  }));

function requestOf(settings: EventTicketingSettings, values: FormValues): EventTicketingUpdate {
  const common = {
    enabled: values.enabled,
    address: values.address,
    instructions: values.instructions,
    reminders: remindersOf(values.reminders),
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
          // правила напоминаний — под полем своей строки (`reminders.N.text`)
          const path = field.path.startsWith('reminders.') ? field.path : formFieldOf(field.path);
          form.setError(path as Path<FormValues>, {
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
      <RemindersFieldset form={form} settings={settings} />
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

/**
 * Напоминания участникам (PR D): до 3 правил «за N часов до старта» с текстом; под сохранённым правилом — время
 * отправки, «Отправлено … · участникам: N» или «прошло» (`late`, RC-D5). Добавление на пределе — `aria-disabled` с
 * причиной. Сохраняются общей кнопкой формы (`requestOf` шлёт `id` существующих).
 */
function RemindersFieldset({
  form,
  settings,
}: {
  form: UseFormReturn<FormValues>;
  settings: EventTicketingSettings;
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'reminders' });
  const rows = useWatch({ control: form.control, name: 'reminders' });
  const limitId = useId();
  const full = fields.length >= EVENT_REMINDERS_MAX;
  const errors = form.formState.errors.reminders;
  const optionsFor = (current: string) =>
    [...new Set([...REMINDER_OFFSETS, Number(current)])]
      .filter((hours) => Number.isInteger(hours) && hours > 0)
      .sort((a, b) => a - b)
      .map((hours) => ({
        value: String(hours),
        label: t('admin.tickets.reminders.offsetOption', { hours }),
      }));
  const statusOf = (id: string | undefined) => {
    const rule = id ? settings.reminders.find((item) => item.id === id) : undefined;
    if (!rule) return undefined;
    if (rule.sentAt) {
      return t('admin.tickets.reminders.sent', {
        date: formatDateTimeLong(rule.sentAt),
        count: rule.sentCount,
      });
    }
    if (rule.late) return t('admin.tickets.reminders.late');
    return rule.sendAt
      ? t('admin.tickets.reminders.sendAt', { date: formatDateTimeLong(rule.sendAt) })
      : t('admin.tickets.reminders.noStart');
  };

  return (
    <fieldset className="form-stack">
      <legend className="t-label">{t('admin.tickets.reminders.title')}</legend>
      <p className="t-meta">{t('admin.tickets.reminders.lead')}</p>
      {fields.map((field, index) => {
        const row = rows[index];
        const status = statusOf(row?.id);
        return (
          <div
            key={field.id}
            role="group"
            aria-label={t('admin.tickets.reminders.item', { n: index + 1 })}
            className="form-stack"
          >
            <SelectField
              label={t('admin.tickets.reminders.offset')}
              options={optionsFor(row?.offsetHours ?? field.offsetHours)}
              error={fieldErrorText(errors?.[index]?.offsetHours?.message)}
              help={status}
              {...form.register(`reminders.${index}.offsetHours`)}
            />
            <TextAreaField
              label={t('admin.tickets.reminders.text')}
              rows={3}
              maxLength={EVENT_REMINDER_TEXT_MAX}
              error={fieldErrorText(errors?.[index]?.text?.message)}
              help={t('admin.tickets.instructionsCount', {
                count: row?.text.length ?? 0,
                max: EVENT_REMINDER_TEXT_MAX,
              })}
              {...form.register(`reminders.${index}.text`)}
            />
            <div className="form-actions">
              <Button size="sm" variant="danger" onClick={() => remove(index)}>
                {t('admin.tickets.reminders.remove')}
              </Button>
            </div>
          </div>
        );
      })}
      <div className="form-actions">
        <Button
          aria-disabled={full || undefined}
          aria-describedby={full ? limitId : undefined}
          onClick={() => {
            if (!full) append({ offsetHours: '24', text: '' });
          }}
        >
          {t('admin.tickets.reminders.add')}
        </Button>
      </div>
      {full ? (
        <DisabledReason id={limitId}>{t('admin.tickets.reminders.limit')}</DisabledReason>
      ) : null}
      <p className="t-meta">{t('admin.tickets.reminders.quietHint')}</p>
      <p className="t-meta">{t('admin.tickets.reminders.recreateHint')}</p>
    </fieldset>
  );
}
