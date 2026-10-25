import { zodResolver } from '@hookform/resolvers/zod';
import { isNetworkError } from '@pokatim/api-client';
import { DISCIPLINES, type PanelCalendarStart } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { api } from '../../api';
import { fieldErrorText, serverFieldErrors } from '../../field-errors';
import { isConflict } from '../../session/errors';
import {
  Banner,
  Button,
  ConflictBanner,
  DateField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../ui';
import {
  calendarFormOf,
  type CalendarFormOutput,
  CalendarFormSchema,
  type CalendarFormValues,
  calendarInputOf,
  emptyCalendarForm,
} from './calendar-form';

export const CALENDAR_QUERY_KEY = ['admin', 'calendar'] as const;

const DISCIPLINE_OPTIONS = DISCIPLINES.map((value) => ({
  value,
  label: t(`domain.discipline.${value}`),
}));

/**
 * Форма записи календаря в правой колонке («Новая запись» публикует сразу; «Изменить»): ошибки — под полями
 * (в том числе недействительная ссылка и порядок дат с сервера); 409 — «Запись изменили — обновите страницу».
 */
export function CalendarForm({
  start,
  onDone,
}: {
  start: PanelCalendarStart | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const form = useForm<CalendarFormValues, unknown, CalendarFormOutput>({
    resolver: zodResolver(CalendarFormSchema),
    defaultValues: start ? calendarFormOf(start) : emptyCalendarForm(),
  });
  const save = useMutation({
    mutationFn: (values: CalendarFormOutput) => {
      const input = calendarInputOf(values);
      return start
        ? api.updateCalendarStart(start.id, { version: start.version, ...input })
        : api.createCalendarStart(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      onDone();
    },
    onError: (error) => {
      if (isConflict(error)) return setConflict(true);
      const fields = serverFieldErrors(error);
      if (fields?.length) {
        for (const field of fields) {
          form.setError(field.path as keyof CalendarFormValues, {
            type: 'server',
            message: field.code,
          });
        }
        return;
      }
      setFailure(isNetworkError(error) ? t('error.network') : t('admin.saveFailed'));
    },
  });
  const errors = form.formState.errors;
  const errorOf = (field: keyof CalendarFormValues) => fieldErrorText(errors[field]?.message);
  const title = start ? t('admin.calendar.editTitle') : t('admin.calendar.newTitle');

  return (
    <form
      noValidate
      aria-label={title}
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setFailure(undefined);
          save.mutate(values);
        })(event)
      }
    >
      <h2 className="t-panel-title-sm">{title}</h2>
      {conflict ? (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            void queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEY });
            onDone();
          }}
        />
      ) : null}
      <TextField
        label={t('admin.calendar.field.title')}
        autoComplete="off"
        error={errorOf('title')}
        {...form.register('title')}
      />
      {(['startsOn', 'endsOn'] as const).map((name) => (
        <Controller
          key={name}
          control={form.control}
          name={name}
          render={({ field }) => (
            <DateField
              label={t(`admin.calendar.field.${name}`)}
              zoneLabel={t('admin.zone')}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errorOf(name)}
            />
          )}
        />
      ))}
      <TextField
        label={t('admin.calendar.field.startTime')}
        type="time"
        error={errorOf('startTime')}
        {...form.register('startTime')}
      />
      <SelectField
        label={t('admin.calendar.field.discipline')}
        options={DISCIPLINE_OPTIONS}
        {...form.register('discipline')}
      />
      <TextField
        label={t('admin.calendar.field.city')}
        autoComplete="off"
        error={errorOf('city')}
        {...form.register('city')}
      />
      <TextField
        label={t('admin.calendar.field.place')}
        autoComplete="off"
        error={errorOf('place')}
        {...form.register('place')}
      />
      <TextField
        label={t('admin.calendar.field.distancesKm')}
        inputMode="decimal"
        autoComplete="off"
        help={t('admin.calendar.field.distancesHint')}
        error={errorOf('distancesKm')}
        {...form.register('distancesKm')}
      />
      <TextField
        label={t('admin.calendar.field.registrationUrl')}
        type="url"
        autoComplete="off"
        help={t('admin.calendar.field.registrationHint')}
        error={errorOf('registrationUrl')}
        {...form.register('registrationUrl')}
      />
      <TextAreaField
        label={t('admin.calendar.field.description')}
        error={errorOf('description')}
        {...form.register('description')}
      />
      {failure ? (
        <Banner tone="error" role="alert">
          {failure}
        </Banner>
      ) : null}
      <div className="form-actions">
        <Button type="submit" variant="primary" busy={save.isPending}>
          {start ? t('admin.calendar.save') : t('admin.calendar.publish')}
        </Button>
        <Button
          onClick={() => {
            form.reset();
            onDone();
          }}
        >
          {t('admin.calendar.cancel')}
        </Button>
      </div>
    </form>
  );
}
