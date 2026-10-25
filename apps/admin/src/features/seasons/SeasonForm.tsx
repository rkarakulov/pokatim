import { zodResolver } from '@hookform/resolvers/zod';
import { isNetworkError } from '@pokatim/api-client';
import { type PanelSeason, SeasonInput } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { api } from '../../api';
import { fieldErrorText, serverFieldErrors } from '../../field-errors';
import { isConflict } from '../../session/errors';
import { Banner, Button, ConflictBanner, DateField, DisabledReason, TextField } from '../../ui';
import { overlapHint, overlapText } from './season-hints';
import { SEASONS_QUERY_KEY } from './seasons-query';

type Path = 'name' | 'startsOn' | 'endsOn';

/**
 * Форма сезона в правой колонке («Новый сезон» / «Изменить»): пересечение с загруженными сезонами — подсказка под
 * полем и неактивная кнопка с причиной (сервер всё равно проверит); завершённый сезон — даты только для чтения;
 * ошибки сервера — под полями; 409 — «Запись изменили — обновите страницу».
 */
export function SeasonForm({
  season,
  seasons,
  onDone,
}: {
  season: PanelSeason | undefined;
  seasons: readonly PanelSeason[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [failure, setFailure] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const finished = season?.phase === 'finished';
  const form = useForm({
    resolver: zodResolver(SeasonInput),
    defaultValues: {
      name: season?.name ?? '',
      startsOn: season?.startsOn ?? '',
      endsOn: season?.endsOn ?? '',
    },
  });
  const [startsOn, endsOn] = useWatch({ control: form.control, name: ['startsOn', 'endsOn'] });
  const overlap = finished ? undefined : overlapHint(seasons, { startsOn, endsOn }, season?.id);

  const save = useMutation({
    mutationFn: (body: SeasonInput) =>
      season
        ? api.updateSeason(season.id, {
            version: season.version,
            ...(body.name !== season.name ? { name: body.name } : {}),
            ...(finished ? {} : { startsOn: body.startsOn, endsOn: body.endsOn }),
          })
        : api.createSeason(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SEASONS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      form.reset();
      onDone();
    },
    onError: (error) => {
      if (isConflict(error)) return setConflict(true);
      const fields = serverFieldErrors(error);
      if (fields?.length) {
        for (const field of fields) {
          form.setError(field.path as Path, { type: 'server', message: field.code });
        }
        return;
      }
      setFailure(isNetworkError(error) ? t('error.network') : t('admin.saveFailed'));
    },
  });

  const errors = form.formState.errors;
  const textOf = (path: Path) => {
    const code = errors[path]?.message;
    if (code === 'SEASON_OVERLAP' && overlap) return overlapText(overlap.season);
    return fieldErrorText(code);
  };
  const dateError = (path: 'startsOn' | 'endsOn') =>
    overlap?.path === path ? overlapText(overlap.season) : textOf(path);
  const blocked = Boolean(overlap);

  return (
    <form
      noValidate
      aria-label={
        season ? t('admin.seasons.editTitle', { name: season.name }) : t('admin.seasons.new')
      }
      onSubmit={(event) =>
        void form.handleSubmit((body) => {
          if (blocked) return;
          setFailure(undefined);
          save.mutate(body);
        })(event)
      }
    >
      <h2 className="t-panel-title-sm">
        {season ? t('admin.seasons.editTitle', { name: season.name }) : t('admin.seasons.new')}
      </h2>
      {conflict ? (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            void queryClient.invalidateQueries({ queryKey: SEASONS_QUERY_KEY });
            onDone();
          }}
        />
      ) : null}
      <TextField
        label={t('admin.seasons.name')}
        autoComplete="off"
        error={textOf('name')}
        {...form.register('name')}
      />
      <Controller
        control={form.control}
        name="startsOn"
        render={({ field }) => (
          <DateField
            label={t('admin.seasons.startsOn')}
            zoneLabel={t('admin.zone')}
            lockedLabel={finished ? t('admin.locked') : undefined}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={dateError('startsOn')}
          />
        )}
      />
      <Controller
        control={form.control}
        name="endsOn"
        render={({ field }) => (
          <DateField
            label={t('admin.seasons.endsOn')}
            zoneLabel={t('admin.zone')}
            lockedLabel={finished ? t('admin.locked') : undefined}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={dateError('endsOn')}
            help={finished ? t('admin.seasons.finishedHint') : t('admin.seasons.hint')}
          />
        )}
      />
      {failure ? (
        <Banner tone="error" role="alert">
          {failure}
        </Banner>
      ) : null}
      <div className="form-actions">
        <Button
          type="submit"
          variant="primary"
          busy={save.isPending}
          aria-disabled={blocked || undefined}
          aria-describedby={blocked ? reasonId : undefined}
        >
          {season ? t('admin.seasons.save') : t('admin.seasons.create')}
        </Button>
        <Button
          onClick={() => {
            form.reset();
            onDone();
          }}
        >
          {t('admin.seasons.cancel')}
        </Button>
        {blocked ? (
          <DisabledReason id={reasonId}>{t('admin.seasons.fixDates')}</DisabledReason>
        ) : null}
      </div>
    </form>
  );
}
