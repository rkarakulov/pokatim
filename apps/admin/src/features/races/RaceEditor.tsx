import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  BIKE_CLASSES,
  type PanelRace,
  RACE_CANCEL_REASONS,
  type RaceCancelReason,
  type RaceEditBlockReason,
  type RaceField,
  SURFACES,
} from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { api } from '../../api';
import { errorCodeOf, fieldErrorText, formFieldOf, serverFieldErrors } from '../../field-errors';
import { formatDateTimeLong, formatKmFromMeters } from '../../format';
import { isConflict } from '../../session/errors';
import {
  Banner,
  Button,
  ChipGroup,
  ChoiceDialog,
  ConflictBanner,
  DateTimeField,
  Dialog,
  DisabledReason,
  LockMark,
  PageHeader,
  ReadonlyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../ui';
import { seasonOfDate, seasonRangeText } from '../seasons/season-hints';
import { seasonsQuery } from '../seasons/seasons-query';
import { CorridorField } from './CorridorField';
import {
  earliestProtocol,
  emptyRaceForm,
  type RaceFormOutput,
  RaceFormSchema,
  type RaceFormValues,
  raceChanges,
  raceFormOf,
  raceInputOf,
  wallMs,
} from './race-form';
import { RACES_QUERY_KEY, raceQuery } from './races-query';
import { routeQuery } from './routes-query';

const BIKE_CLASS_OPTIONS = BIKE_CLASSES.map((value) => ({
  value,
  label: t(`domain.bikeClass.${value}`),
}));
const SURFACE_OPTIONS = SURFACES.map((value) => ({ value, label: t(`domain.surface.${value}`) }));
const CANCEL_CHOICES = RACE_CANCEL_REASONS.map((value) => ({
  value,
  label: t(`domain.raceCancelReason.${value}`),
}));

/** Причина неактивной «Опубликовать» по `editable.reasons` сервера. */
const PUBLISH_REASON: Partial<Record<RaceEditBlockReason, MessageKey>> = {
  window_closed: 'admin.races.reason.publish_window_closed',
  outside_season: 'admin.races.reason.outside_season',
};

/** Поле формы для пути ошибки сервера: коридор — свои поля формы (`corridor.routeId` → «Эталонный коридор»). */
function formPathOf(path: string): keyof RaceFormValues {
  if (path === 'corridor.widthM') return 'corridorWidthM';
  if (path === 'corridor' || path.startsWith('corridor.')) return 'corridorRouteId';
  return formFieldOf(path) as keyof RaceFormValues;
}

/** Текст ошибки действия над гонкой (кроме полей и 409 версии). */
function actionErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  if (apiErrorOf(error)?.code === 'RACE_INVALID_STATE') {
    return t('admin.races.error.RACE_INVALID_STATE');
  }
  return t('admin.saveFailed');
}

/** Подтверждение без причины (публикация, удаление черновика). */
function ConfirmDialog({
  open,
  title,
  consequences,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  consequences: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => {
    if (busy) return;
    setError(undefined);
    onClose();
  };
  return (
    <Dialog open={open} title={title} onClose={close}>
      <p className="dialog__consequences t-body">{consequences}</p>
      {error ? (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      ) : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={busy}>
          {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
        </Button>
        <Button
          variant={destructive ? 'dangerSolid' : 'primary'}
          busy={busy}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            onConfirm()
              .then(() => onClose())
              .catch((failure: unknown) => setError(actionErrorText(failure)))
              .finally(() => setBusy(false));
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

type Pending = 'publish' | 'discard' | 'cancel' | undefined;

/**
 * Форма гонки одной колонкой («Новая гонка» и «Редактирование»): группы «Гонка» и «Окно и протокол», метки
 * Europe/Minsk, чипы покрытия, вычисляемый сезон только для чтения, подсказка и ошибка правила 48 ч с ближайшей
 * допустимой датой. Что можно менять — `editable` сервера (зафиксированные поля — с замком, причина под кнопкой).
 * Подсказки правил — только отображение, решает сервер.
 */
export function RaceEditor({
  race: latest,
  refreshFailed = false,
  onRetryRefresh,
}: {
  race?: PanelRace;
  /** Фоновое обновление карточки не удалось — данные остаются, сверху баннер с повтором (§4.12). */
  refreshFailed?: boolean;
  onRetryRefresh?: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  /**
   * Снимок, на котором основана форма (R3): версия запросов и база сравнения изменённых полей. Меняется только своим
   * `reset` (сохранение, публикация, отмена, «Обновить»); фоновый ответ с новой версией — конфликт, введённое остаётся.
   */
  const [race, setBase] = useState(latest);
  const stale = latest !== undefined && race !== undefined && latest.version > race.version;
  /**
   * Вычисляемые сервером поля (фаза, сезон, `editable`) меняются без смены версии (часы, новый сезон): при той же
   * версии берутся из свежего ответа; значения формы и версия — из снимка.
   */
  const view = latest && race && latest.version === race.version ? latest : race;
  const seasonsState = useQuery(seasonsQuery);
  const seasons = seasonsState.data;
  const submitReasonId = useId();
  const publishReasonId = useId();
  const [failure, setFailure] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<Pending>();

  const form = useForm<RaceFormValues, unknown, RaceFormOutput>({
    resolver: zodResolver(RaceFormSchema),
    defaultValues: race ? raceFormOf(race) : emptyRaceForm(),
  });
  const [windowEndsAt, protocolPlannedAt, corridorRouteId, corridorWidthM] = useWatch({
    control: form.control,
    name: ['windowEndsAt', 'protocolPlannedAt', 'corridorRouteId', 'corridorWidthM'],
  });
  // дистанция с коридором — длина выбранного маршрута (тот же запрос, что у превью; источник истины — сервер)
  const corridorRoute = useQuery({
    ...routeQuery(corridorRouteId),
    enabled: corridorRouteId !== '',
  }).data;
  const corridorDistanceM =
    corridorRoute?.distanceM ??
    (race?.corridor?.route.id === corridorRouteId ? race.corridor.distanceM : undefined);

  const editable = view?.editable;
  const locked = (field: RaceField) => (editable ? !editable.fields.includes(field) : false);
  const lockMark = (field: RaceField) =>
    locked(field) ? <LockMark label={t('admin.locked')} /> : undefined;
  const lockedLabel = (field: RaceField) => (locked(field) ? t('admin.locked') : undefined);
  // коридор снят в форме (и его можно менять) — дистанция снова вводится вручную, хотя `editable` сервера ещё
  // считает её вычисляемой (до сохранения)
  const distanceLocked = locked('distanceKm') && (corridorRouteId !== '' || locked('corridor'));

  // подсказки правил (сервер решает): ближайшая дата протокола, «только позже» после закрытия окна
  const earliest = earliestProtocol(windowEndsAt);
  const protocolMs = wallMs(protocolPlannedAt);
  const tooEarly =
    earliest !== undefined && protocolMs !== undefined && protocolMs < Date.parse(earliest);
  const onlyLater =
    race !== undefined &&
    view?.phase === 'closed' &&
    protocolMs !== undefined &&
    protocolMs < Date.parse(race.protocolPlannedAt);
  const season =
    seasons && /^\d{4}-\d{2}-\d{2}/.test(windowEndsAt)
      ? seasonOfDate(seasons, windowEndsAt.slice(0, 10))
      : undefined;
  // «нет сезона» — только после успешного ответа; загрузка — скелетон, ошибка без данных — повтор
  const seasonValue: ReactNode = seasons ? (
    season ? (
      t('admin.races.seasonValue', { name: season.name, range: seasonRangeText(season) })
    ) : (
      t('admin.races.seasonNone')
    )
  ) : seasonsState.isError ? (
    <>
      {t('admin.races.seasonsFailed')}{' '}
      <Button size="sm" onClick={() => void seasonsState.refetch()}>
        {t('admin.races.seasonsRetry')}
      </Button>
    </>
  ) : (
    <span className="skeleton"> </span>
  );

  const reset = (next: PanelRace) => {
    setBase(next);
    setConflict(false);
    queryClient.setQueryData(raceQuery(next.id).queryKey, next);
    form.reset(raceFormOf(next));
  };
  const afterChange = async () => {
    await queryClient.invalidateQueries({ queryKey: [...RACES_QUERY_KEY, 'list'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const handleError = (error: unknown) => {
    if (isConflict(error)) return setConflict(true);
    const fields = serverFieldErrors(error);
    if (fields?.length) {
      for (const field of fields) {
        // вложенный путь (`surfaces.0`) — ошибка под полем целиком
        form.setError(formPathOf(field.path), { type: 'server', message: field.code });
      }
      return;
    }
    setFailure(actionErrorText(error));
  };

  const save = useMutation({
    mutationFn: async (values: RaceFormOutput) => {
      const input = raceInputOf(values);
      if (!race) return api.createRace(input);
      return api.updateRace(race.id, {
        version: race.version,
        ...raceChanges({ ...race, editable: view?.editable ?? race.editable }, input),
      });
    },
    onSuccess: async (saved) => {
      await afterChange();
      if (!race) {
        await navigate({ to: '/races/$raceId', params: { raceId: saved.id } });
        return;
      }
      reset(saved);
    },
    onError: handleError,
  });

  const errors = form.formState.errors;
  const errorOf = (field: keyof RaceFormValues): string | undefined => {
    const code = errorCodeOf(errors[field]);
    if (field === 'protocolPlannedAt') {
      if (code === 'PROTOCOL_ONLY_LATER' || (!code && onlyLater)) {
        return race
          ? t('field.error.PROTOCOL_ONLY_LATER', {
              date: formatDateTimeLong(race.protocolPlannedAt),
            })
          : undefined;
      }
      if ((code === 'PROTOCOL_TOO_EARLY' || (!code && tooEarly)) && earliest) {
        return t('field.error.PROTOCOL_TOO_EARLY_AT', { date: formatDateTimeLong(earliest) });
      }
    }
    return fieldErrorText(code);
  };
  const protocolHelp = earliest
    ? race && view?.phase === 'closed'
      ? t('admin.races.protocolClosedHint', { date: formatDateTimeLong(race.protocolPlannedAt) })
      : view?.phase === 'open'
        ? t('admin.races.protocolOpenHint', { date: formatDateTimeLong(earliest) })
        : t('admin.races.protocolHint', { date: formatDateTimeLong(earliest) })
    : undefined;
  const blocked = tooEarly || onlyLater;
  const canSave = !editable || editable.fields.length > 0;

  const refresh = async () => {
    if (!race) return;
    setConflict(false);
    const next = await queryClient.fetchQuery({ ...raceQuery(race.id), staleTime: 0 });
    reset(next);
  };

  const publishBlocked = editable && !editable.canPublish;
  const publishReason = editable?.reasons
    .map((reason) => PUBLISH_REASON[reason])
    .find((key): key is MessageKey => key !== undefined);
  // причины ограничений правки под формой: фаза окна, отмена, заявки участников (V-12), протокол (D-19)
  const editReasons = (editable?.reasons ?? []).filter(
    (reason) =>
      reason === 'window_open' ||
      reason === 'window_closed' ||
      reason === 'cancelled' ||
      reason === 'entries_locked' ||
      reason === 'results_final',
  );

  const actions: ReactNode = race ? (
    <div className="form-actions">
      {race.status === 'draft' ? (
        <>
          <Button
            variant="primary"
            aria-disabled={publishBlocked || undefined}
            aria-describedby={publishBlocked ? publishReasonId : undefined}
            onClick={() => {
              if (!publishBlocked) setPending('publish');
            }}
          >
            {t('admin.races.publish')}
          </Button>
          {editable?.canDiscard ? (
            <Button variant="danger" onClick={() => setPending('discard')}>
              {t('admin.races.discard')}
            </Button>
          ) : null}
          {publishBlocked && publishReason ? (
            <DisabledReason id={publishReasonId}>{t(publishReason)}</DisabledReason>
          ) : null}
        </>
      ) : null}
      {editable?.canCancel ? (
        <Button variant="danger" onClick={() => setPending('cancel')}>
          {t('admin.races.cancelRace')}
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link className="link" to="/races">
              {t('admin.races.title')}
            </Link>
            {' › '}
            {race ? `${race.title} › ${t('admin.races.editCrumb')}` : t('admin.races.new')}
          </>
        }
        title={race ? race.title : t('admin.races.new')}
        meta={
          race
            ? `${t('admin.races.headline', {
                phase: t(`domain.racePhase.${(view ?? race).phase}`),
                protocol: formatDateTimeLong(race.protocolPlannedAt),
              })}${view?.season ? ` · ${view.season.name}` : ''}`
            : t('admin.races.zoneLead')
        }
        actions={actions}
      />
      <div className="page-body form-column">
        {refreshFailed ? (
          <Banner
            tone="error"
            role="alert"
            title={t('admin.refreshFailed')}
            actions={
              <Button size="sm" onClick={onRetryRefresh}>
                {t('state.retry')}
              </Button>
            }
          >
            {t('admin.refreshFailedMessage')}
          </Banner>
        ) : null}
        {seasons && seasonsState.isError ? (
          <Banner
            tone="error"
            role="alert"
            title={t('admin.races.seasonsRefreshFailed')}
            actions={
              <Button size="sm" onClick={() => void seasonsState.refetch()}>
                {t('admin.races.seasonsRetry')}
              </Button>
            }
          />
        ) : null}
        {conflict || stale ? <ConflictBanner onReload={() => void refresh()} /> : null}
        {editReasons.map((reason) => (
          <Banner key={reason}>{t(`admin.races.reason.${reason}`)}</Banner>
        ))}
        <form
          noValidate
          aria-label={race ? race.title : t('admin.races.new')}
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              if (blocked) return;
              setFailure(undefined);
              save.mutate(values);
            })(event)
          }
        >
          <section className="form-group">
            <h2 className="form-group__title t-label">{t('admin.races.group.race')}</h2>
            <TextField
              label={t('admin.races.field.title')}
              labelAside={lockMark('title')}
              autoComplete="off"
              readOnly={locked('title')}
              className={locked('title') ? 'field__control--locked' : undefined}
              error={errorOf('title')}
              {...form.register('title')}
            />
            <Controller
              control={form.control}
              name="bikeClass"
              render={({ field }) => (
                <SelectField
                  label={t('admin.races.field.bikeClass')}
                  labelAside={lockMark('bikeClass')}
                  options={BIKE_CLASS_OPTIONS}
                  value={field.value}
                  disabled={locked('bikeClass')}
                  className={locked('bikeClass') ? 'field__control--locked' : undefined}
                  onChange={(event) => field.onChange(event.target.value)}
                  error={errorOf('bikeClass')}
                />
              )}
            />
            <Controller
              control={form.control}
              name="surfaces"
              render={({ field }) => (
                <ChipGroup
                  label={t('admin.races.field.surfaces')}
                  labelAside={lockMark('surfaces')}
                  options={SURFACE_OPTIONS}
                  value={field.value}
                  disabled={locked('surfaces')}
                  onChange={field.onChange}
                  error={errorOf('surfaces')}
                />
              )}
            />
            <Controller
              control={form.control}
              name="corridorRouteId"
              render={({ field }) => (
                <CorridorField
                  value={field.value}
                  onChange={field.onChange}
                  locked={locked('corridor')}
                  current={race?.corridor}
                  error={errorOf('corridorRouteId')}
                />
              )}
            />
            {corridorRouteId !== '' ? (
              <TextField
                label={t('admin.races.field.corridorWidthM')}
                labelAside={lockMark('corridor')}
                inputMode="numeric"
                autoComplete="off"
                readOnly={locked('corridor')}
                className={locked('corridor') ? 'field__control--locked' : undefined}
                error={errorOf('corridorWidthM')}
                help={
                  /^\d+$/.test(corridorWidthM.trim())
                    ? t('admin.races.corridor.widthHint', { width: corridorWidthM.trim() })
                    : undefined
                }
                {...form.register('corridorWidthM')}
              />
            ) : null}
            {corridorRouteId !== '' ? (
              <ReadonlyField
                label={t('admin.races.field.distanceKm')}
                value={
                  corridorDistanceM !== undefined ? (
                    t('admin.races.corridor.distanceByRoute', {
                      distance: formatKmFromMeters(corridorDistanceM),
                    })
                  ) : (
                    <span className="skeleton"> </span>
                  )
                }
              />
            ) : (
              <TextField
                label={t('admin.races.field.distanceKm')}
                labelAside={distanceLocked ? lockMark('distanceKm') : undefined}
                inputMode="decimal"
                autoComplete="off"
                readOnly={distanceLocked}
                className={distanceLocked ? 'field__control--locked' : undefined}
                error={errorOf('distanceKm')}
                {...form.register('distanceKm')}
              />
            )}
            <TextAreaField
              label={t('admin.races.field.description')}
              labelAside={lockMark('description')}
              readOnly={locked('description')}
              className={locked('description') ? 'field__control--locked' : undefined}
              error={errorOf('description')}
              {...form.register('description')}
            />
          </section>

          <section className="form-group">
            <h2 className="form-group__title t-label">{t('admin.races.group.window')}</h2>
            {(['windowStartsAt', 'windowEndsAt'] as const).map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <DateTimeField
                    label={t(`admin.races.field.${name}`)}
                    zoneLabel={t('admin.zone')}
                    lockedLabel={lockedLabel(name)}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={errorOf(name)}
                  />
                )}
              />
            ))}
            <ReadonlyField
              label={t('admin.races.field.season')}
              value={seasonValue}
              help={t('admin.races.seasonHint')}
            />
            <Controller
              control={form.control}
              name="protocolPlannedAt"
              render={({ field }) => (
                <DateTimeField
                  label={t('admin.races.field.protocolPlannedAt')}
                  zoneLabel={t('admin.zone')}
                  lockedLabel={lockedLabel('protocolPlannedAt')}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errorOf('protocolPlannedAt')}
                  // ошибка правила уже называет дату — подсказка под ней не дублируется
                  help={errorOf('protocolPlannedAt') ? undefined : protocolHelp}
                />
              )}
            />
          </section>

          {failure ? (
            <Banner tone="error" role="alert">
              {failure}
            </Banner>
          ) : null}
          {canSave ? (
            <div className="form-actions">
              <Button
                type="submit"
                variant="primary"
                busy={save.isPending}
                aria-disabled={blocked || undefined}
                aria-describedby={blocked ? submitReasonId : undefined}
              >
                {race ? t('admin.races.save') : t('admin.races.create')}
              </Button>
              <Link className="button t-panel-button" to="/races">
                {t('admin.races.cancelEdit')}
              </Link>
              {blocked ? (
                <DisabledReason id={submitReasonId}>{t('admin.races.fixErrors')}</DisabledReason>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>

      {race ? (
        <>
          <ConfirmDialog
            open={pending === 'publish'}
            title={t('admin.races.publishTitle')}
            consequences={t('admin.races.publishConsequences')}
            confirmLabel={t('admin.races.publish')}
            onConfirm={async () => {
              try {
                reset(await api.publishRace(race.id, { version: race.version }));
                await afterChange();
              } catch (error) {
                if (isConflict(error) || serverFieldErrors(error)) {
                  handleError(error);
                  return;
                }
                throw error;
              }
            }}
            onClose={() => setPending(undefined)}
          />
          <ConfirmDialog
            open={pending === 'discard'}
            title={t('admin.races.discardTitle')}
            consequences={t('admin.races.discardConsequences')}
            confirmLabel={t('admin.races.discard')}
            destructive
            onConfirm={async () => {
              try {
                await api.discardRace(race.id, { version: race.version });
              } catch (error) {
                if (isConflict(error)) {
                  handleError(error);
                  return;
                }
                throw error;
              }
              queryClient.removeQueries({ queryKey: raceQuery(race.id).queryKey });
              await afterChange();
              await navigate({ to: '/races' });
            }}
            onClose={() => setPending(undefined)}
          />
          <ChoiceDialog<RaceCancelReason>
            open={pending === 'cancel'}
            title={t('admin.races.cancelTitle')}
            consequences={t('admin.races.cancelConsequences')}
            choicesLabel={t('admin.races.cancelReasons')}
            choices={CANCEL_CHOICES}
            preview={(reason) =>
              reason
                ? t('admin.races.cancelPreview', {
                    reason: t(`domain.raceCancelReason.${reason}`).toLowerCase(),
                  })
                : t('admin.races.cancelPreviewEmpty')
            }
            confirmLabel={t('admin.races.cancelRace')}
            destructive
            errorText={actionErrorText}
            onConfirm={async (reason) => {
              try {
                reset(await api.cancelRace(race.id, { version: race.version, reason }));
                await afterChange();
              } catch (error) {
                if (isConflict(error)) {
                  handleError(error);
                  return;
                }
                throw error;
              }
            }}
            onClose={() => setPending(undefined)}
          />
        </>
      ) : null}
    </>
  );
}
