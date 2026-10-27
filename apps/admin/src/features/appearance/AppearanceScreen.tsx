import { isNetworkError } from '@pokatim/api-client';
import { APP_THEME_IDS, type AppThemeId, type PanelAppearance } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api';
import { isConflict } from '../../session/errors';
import {
  Banner,
  Button,
  CardRadioGroup,
  type CardRadioOption,
  ConflictBanner,
  ErrorState,
  PageHeader,
} from '../../ui';
import { THEME_PREVIEWS } from './theme-previews';
import { ThemePreview } from './ThemePreview';

const APPEARANCE_QUERY_KEY = ['admin', 'appearance'] as const;

/**
 * «Оформление приложения» (`appearance.manage`, только admin): 7 карточек тем, текущая — с бейджем; «Сохранить»
 * отправляет выбранную тему и версию последнего ответа. Форма из одного поля — `useState`, тело проверяет сервер.
 * Панель остаётся в теме `panel` (T6).
 */
export function AppearanceScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: APPEARANCE_QUERY_KEY, queryFn: () => api.getAppearance() });
  // выбор пользователя; `undefined` — показывать сохранённую тему
  const [choice, setChoice] = useState<AppThemeId>();
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [savedNotice, setSavedNotice] = useState(false);

  const current = query.data;
  const selected = choice ?? current?.themeId;

  const save = useMutation({
    mutationFn: (body: { themeId: AppThemeId; version: number }) => api.updateAppearance(body),
    onMutate: () => {
      setFailure(undefined);
      setConflict(false);
      setSavedNotice(false);
    },
    onSuccess: async (next: PanelAppearance) => {
      queryClient.setQueryData(APPEARANCE_QUERY_KEY, next);
      setChoice(undefined);
      setSavedNotice(true);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => {
      if (isConflict(error)) return setConflict(true);
      setFailure(isNetworkError(error) ? t('error.network') : t('admin.appearance.saveFailed'));
    },
  });

  // после 409: выбор и конфликт сбрасываются только после успешного перечитывания (ошибка — баннер с повтором)
  const reload = async () => {
    const result = await query.refetch();
    if (result.isSuccess) {
      setChoice(undefined);
      setConflict(false);
    }
  };
  const paused = query.fetchStatus === 'paused';

  const options: CardRadioOption<AppThemeId>[] = APP_THEME_IDS.map((id) => ({
    value: id,
    label: t(`admin.appearance.theme.${id}.name`),
    children: (
      <>
        <ThemePreview palette={THEME_PREVIEWS[id]} />
        <span className="card-radio__text muted t-meta">
          {t(`admin.appearance.theme.${id}.description`)}
        </span>
        {current?.themeId === id ? (
          <span className="card-radio__badge t-label">{t('admin.appearance.current')}</span>
        ) : null}
      </>
    ),
  }));

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
          {savedNotice ? <Banner role="status">{t('admin.appearance.saved')}</Banner> : null}
          <CardRadioGroup
            legend={t('admin.appearance.legend')}
            options={options}
            value={selected}
            onChange={(value) => {
              setChoice(value);
              setSavedNotice(false);
            }}
          />
          {failure ? (
            <Banner tone="error" role="alert">
              {failure}
            </Banner>
          ) : null}
          <div className="form-actions">
            <Button
              variant="primary"
              busy={save.isPending}
              disabled={!selected || selected === current.themeId}
              onClick={() => {
                if (selected) save.mutate({ themeId: selected, version: current.version });
              }}
            >
              {t('admin.appearance.save')}
            </Button>
          </div>
        </div>
      ) : query.isError || paused ? (
        <ErrorState error={query.error} offline={paused} onRetry={() => void query.refetch()} />
      ) : (
        <div aria-busy="true" data-testid="appearance-loading">
          <div className="card-radios__grid" aria-hidden="true">
            {APP_THEME_IDS.map((id) => (
              <span
                key={id}
                className="skeleton card-radio__skeleton"
                data-testid="skeleton-theme-card"
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
