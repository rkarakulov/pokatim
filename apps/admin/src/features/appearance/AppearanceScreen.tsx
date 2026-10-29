import { isNetworkError } from '@pokatim/api-client';
import type { PanelAppearance, UpdateAppearanceRequest } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { api } from '../../api';
import { isConflict } from '../../session/errors';
import { Banner, Button, ConflictBanner, ErrorState, PageHeader } from '../../ui';

const APPEARANCE_QUERY_KEY = ['admin', 'appearance'] as const;

/**
 * «Оформление приложения» (`appearance.manage`, только admin): сезонный декор (halloween-decor) — одна кнопка включает
 * или выключает сразу, с версией последнего ответа. Тему каждый райдер выбирает сам (user-theme, ADR-0021). Панель
 * остаётся в теме `panel` (T6).
 */
export function AppearanceScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: APPEARANCE_QUERY_KEY, queryFn: () => api.getAppearance() });
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const decorTitleId = useId();

  const current = query.data;

  const save = useMutation({
    mutationFn: (body: UpdateAppearanceRequest) => api.updateAppearance(body),
    onMutate: () => {
      setFailure(undefined);
      setConflict(false);
      setNotice(undefined);
    },
    onSuccess: async (next: PanelAppearance) => {
      queryClient.setQueryData(APPEARANCE_QUERY_KEY, next);
      setNotice(t(`admin.appearance.decor.saved.${next.decor}`));
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => {
      if (isConflict(error)) return setConflict(true);
      setFailure(
        isNetworkError(error) ? t('error.network') : t('admin.appearance.decor.saveFailed'),
      );
    },
  });

  // после 409: конфликт сбрасывается только после успешного перечитывания (ошибка — баннер с повтором)
  const reload = async () => {
    const result = await query.refetch();
    if (result.isSuccess) setConflict(false);
  };
  const paused = query.fetchStatus === 'paused';

  return (
    <>
      <PageHeader title={t('admin.appearance.title')} meta={t('admin.appearance.hint')} />
      {current ? (
        <div className="appearance">
          {query.isError ? (
            <Banner
              tone="warning"
              title={t('state.staleTitle')}
              actions={
                <Button
                  size="sm"
                  busy={query.isFetching}
                  onClick={() => void (conflict ? reload() : query.refetch())}
                >
                  {t('state.retry')}
                </Button>
              }
            >
              {t('state.staleMessage')}
            </Banner>
          ) : null}
          {conflict ? (
            <ConflictBanner busy={query.isFetching} onReload={() => void reload()} />
          ) : null}
          {notice ? <Banner role="status">{notice}</Banner> : null}
          {failure ? (
            <Banner tone="error" role="alert">
              {failure}
            </Banner>
          ) : null}
          <section className="section" aria-labelledby={decorTitleId}>
            <h2 id={decorTitleId} className="section__title t-label">
              {t('admin.appearance.decor.title')}
            </h2>
            <p className="muted t-meta">{t('admin.appearance.decor.hint')}</p>
            <p>{t(`admin.appearance.decor.state.${current.decor}`)}</p>
            <div className="form-actions">
              <Button
                busy={save.isPending}
                onClick={() =>
                  save.mutate({
                    decor: current.decor === 'halloween' ? 'none' : 'halloween',
                    version: current.version,
                  })
                }
              >
                {t(`admin.appearance.decor.toggle.${current.decor}`)}
              </Button>
            </div>
          </section>
        </div>
      ) : query.isError || paused ? (
        <ErrorState error={query.error} offline={paused} onRetry={() => void query.refetch()} />
      ) : (
        <div aria-busy="true" data-testid="appearance-loading">
          <p className="skeleton t-title-sm"> </p>
          <p className="skeleton t-meta"> </p>
        </div>
      )}
    </>
  );
}
