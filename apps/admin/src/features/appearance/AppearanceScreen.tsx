import { isNetworkError } from '@pokatim/api-client';
import {
  APP_THEME_IDS,
  type AppThemeId,
  type PanelAppearance,
  type UpdateAppearanceRequest,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

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
 * Сезонный декор (halloween-decor) — одна кнопка: включает или выключает сразу. Панель остаётся в теме `panel` (T6).
 */
export function AppearanceScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: APPEARANCE_QUERY_KEY, queryFn: () => api.getAppearance() });
  // выбор пользователя и версия, при которой он начат (уходит в PUT до сохранения или сброса: перечитывание данных
  // не подменяет её — чужая смена даёт 409, а не тихую перезапись); `undefined` — показывать сохранённую тему
  const [choice, setChoice] = useState<{ themeId: AppThemeId; baseVersion: number }>();
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const decorTitleId = useId();

  const current = query.data;
  const selected = choice?.themeId ?? current?.themeId;

  const save = useMutation({
    mutationFn: (body: UpdateAppearanceRequest) => api.updateAppearance(body),
    onMutate: () => {
      setFailure(undefined);
      setConflict(false);
      setNotice(undefined);
    },
    onSuccess: async (next: PanelAppearance, body) => {
      queryClient.setQueryData(APPEARANCE_QUERY_KEY, next);
      if (body.themeId) {
        setChoice(undefined);
        setNotice(t('admin.appearance.saved'));
      } else {
        // своё переключение декора не устаревает незавершённый выбор темы, начатый при той же версии
        setChoice((prev) =>
          prev?.baseVersion === body.version ? { ...prev, baseVersion: next.version } : prev,
        );
        setNotice(t(`admin.appearance.decor.saved.${next.decor}`));
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error, body) => {
      if (isConflict(error)) return setConflict(true);
      const failed = body.themeId
        ? 'admin.appearance.saveFailed'
        : 'admin.appearance.decor.saveFailed';
      setFailure(isNetworkError(error) ? t('error.network') : t(failed));
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
          {notice ? <Banner role="status">{notice}</Banner> : null}
          <CardRadioGroup
            legend={t('admin.appearance.legend')}
            options={options}
            value={selected}
            onChange={(value) => {
              setChoice((prev) => ({
                themeId: value,
                baseVersion: prev?.baseVersion ?? current.version,
              }));
              setNotice(undefined);
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
              disabled={!choice || choice.themeId === current.themeId}
              onClick={() => {
                if (choice) save.mutate({ themeId: choice.themeId, version: choice.baseVersion });
              }}
            >
              {t('admin.appearance.save')}
            </Button>
          </div>
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
