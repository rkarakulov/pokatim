import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  CITY_CODES,
  type PanelRoute,
  type PanelRouteSummary,
  PublishRouteInput,
  RouteTitle,
  SURFACES,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { api } from '../../api';
import { fieldErrorText, serverFieldErrors } from '../../field-errors';
import { Banner, Button, ChipGroup, Dialog, SelectField, TextField } from '../../ui';
import { RoutePreview, type RouteOpenLink } from './RoutePreview';
import { ROUTES_QUERY_KEY, routeQuery } from './routes-query';

type Path = 'title' | 'city' | 'surfaces';

/**
 * Значения окна: название — всегда (routes-08, RC-14), город — строка выбора (`''` — не выбран → «Заполните поле.»),
 * проверка — схема контракта.
 */
const CatalogFormSchema = z.object({
  title: RouteTitle,
  city: z.string().pipe(PublishRouteInput.shape.city),
  surfaces: PublishRouteInput.shape.surfaces,
});
type CatalogFormValues = z.input<typeof CatalogFormSchema>;

/** Города справочника по алфавиту подписи (свободного текста нет — D2). */
export const CITY_OPTIONS = CITY_CODES.map((code) => ({
  value: code,
  label: t(`domain.city.${code}`),
})).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
export const SURFACE_OPTIONS = SURFACES.map((value) => ({
  value,
  label: t(`domain.surface.${value}`),
}));

/** Ответ после действия с каталогом: маршрут в кэше, списки маршрутов и журнал — заново. */
async function afterCatalogChange(queryClient: QueryClient, route: PanelRoute) {
  queryClient.setQueryData(routeQuery(route.id).queryKey, route);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ROUTES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
  ]);
}

function failureText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  if (apiErrorOf(error)?.code === 'ROUTE_INVALID_STATE') {
    return t('admin.routes.error.ROUTE_INVALID_STATE');
  }
  return t('admin.saveFailed');
}

/**
 * Окно «Опубликовать в каталоге» / «Изменить» (routes-01, D2): превью линии и предупреждение, что линия, старт и
 * финиш станут публичными (RC-11); название (по умолчанию текущее, routes-08, RC-14); город старта — справочник,
 * покрытие — чипы (мультивыбор). Ошибки схемы и сервера — под полями, 409 `ROUTE_INVALID_STATE` и прочее — баннер.
 * Заголовок окна — название до правки.
 */
export function RouteCatalogDialog({
  route,
  onClose,
  openLink = 'same-tab',
}: {
  route: PanelRouteSummary;
  onClose: () => void;
  /** «Открыть маршрут» под превью (routes-05, RC-8): на самой странице маршрута — `false` */
  openLink?: RouteOpenLink;
}) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string>();
  const editing = route.catalog !== null;
  const form = useForm<CatalogFormValues, unknown, PublishRouteInput>({
    resolver: zodResolver(CatalogFormSchema),
    defaultValues: {
      title: route.title,
      city: route.catalog?.city ?? '',
      surfaces: route.catalog?.surfaces ?? [],
    },
  });
  const publish = useMutation({
    mutationFn: (body: PublishRouteInput) => api.publishRoute(route.id, body),
    onSuccess: async (saved) => {
      await afterCatalogChange(queryClient, saved);
      onClose();
    },
    onError: (error) => {
      const fields = serverFieldErrors(error);
      if (fields?.length) {
        for (const field of fields) {
          form.setError(field.path.split('.')[0] as Path, { type: 'server', message: field.code });
        }
        return;
      }
      setFailure(failureText(error));
    },
  });
  const errors = form.formState.errors;
  const close = () => {
    if (!publish.isPending) onClose();
  };

  return (
    <Dialog
      open
      title={
        editing
          ? t('admin.routes.catalog.dialog.editTitle', { title: route.title })
          : t('admin.routes.catalog.dialog.title', { title: route.title })
      }
      onClose={close}
    >
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((body) => {
            setFailure(undefined);
            publish.mutate(body);
          })(event)
        }
      >
        <RoutePreview routeId={route.id} openLink={openLink} />
        <Banner tone="warning">{t('admin.routes.catalog.dialog.hint')}</Banner>
        <TextField
          label={t('admin.routes.field.title')}
          autoComplete="off"
          {...form.register('title')}
          error={fieldErrorText(errors.title?.message)}
        />
        <Controller
          control={form.control}
          name="city"
          render={({ field }) => (
            <SelectField
              label={t('admin.routes.catalog.dialog.city')}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
              options={[
                { value: '', label: t('admin.routes.catalog.dialog.cityPlaceholder') },
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
              label={t('admin.routes.catalog.dialog.surfaces')}
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
        <div className="dialog__actions">
          <Button onClick={close} disabled={publish.isPending}>
            {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
          </Button>
          <Button type="submit" variant="primary" busy={publish.isPending}>
            {editing
              ? t('admin.routes.catalog.dialog.save')
              : t('admin.routes.catalog.dialog.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** «Снять с публикации» — подтверждение без причины (журнал пишет действие); повтор безопасен (RC-2). */
export function UnpublishRouteDialog({
  route,
  onClose,
}: {
  route: PanelRouteSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string>();
  const unpublish = useMutation({
    mutationFn: () => api.unpublishRoute(route.id),
    onSuccess: async (saved) => {
      await afterCatalogChange(queryClient, saved);
      onClose();
    },
    onError: (error) => setFailure(failureText(error)),
  });
  const close = () => {
    if (!unpublish.isPending) onClose();
  };
  return (
    <Dialog
      open
      title={t('admin.routes.catalog.unpublishConfirm.title', { title: route.title })}
      onClose={close}
    >
      <p className="t-body">{t('admin.routes.catalog.unpublishConfirm.message')}</p>
      {failure ? (
        <Banner tone="error" role="alert">
          {failure}
        </Banner>
      ) : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={unpublish.isPending}>
          {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
        </Button>
        <Button variant="danger" busy={unpublish.isPending} onClick={() => unpublish.mutate()}>
          {t('admin.routes.catalog.unpublishConfirm.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
