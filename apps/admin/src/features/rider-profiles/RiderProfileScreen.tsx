import type {
  RiderProfileModerationDetail,
  RiderProfileModerationReport,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useId, useState } from 'react';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { httpStatus, isConflict, isForbidden } from '../../session/errors';
import {
  Banner,
  Button,
  ConflictBanner,
  DataTable,
  DisabledReason,
  EmptyState,
  ErrorState,
  PageHeader,
  ReadonlyField,
  ReasonDialog,
  StatusTag,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { riderLabel } from '../results/results-format';
import { actionErrorText } from './rider-profiles-format';
import { RIDER_PROFILES_QUERY_KEY, riderProfileQuery } from './rider-profiles-query';

const SKELETON_FIELDS = 4;
const column = createColumnHelper<RiderProfileModerationReport>();

type Action = 'resetAvatar' | 'resetClub' | 'resetName' | 'dismiss';
type ResetAction = Exclude<Action, 'dismiss'>;

const RESETS: readonly ResetAction[] = ['resetAvatar', 'resetClub', 'resetName'];

const reportColumns = [
  column.accessor('reason', {
    header: t('admin.riderProfiles.report.reason'),
    cell: (info) => t(`domain.profileReportReason.${info.getValue()}`),
    enableSorting: false,
  }),
  column.accessor('comment', {
    header: t('admin.riderProfiles.report.comment'),
    cell: (info) => info.getValue() ?? t('admin.riderProfiles.none'),
    enableSorting: false,
  }),
  column.accessor('createdAt', {
    header: t('admin.riderProfiles.report.createdAt'),
    cell: (info) => formatDateTimeLong(info.getValue()),
    enableSorting: false,
  }),
  column.accessor('resolution', {
    header: t('admin.riderProfiles.report.resolution'),
    cell: (info) => t(`admin.riderProfiles.resolution.${info.getValue() ?? 'open'}`),
    enableSorting: false,
  }),
];

/** Есть ли что сбрасывать — по карточке (сервер всё равно ответит `{ reset: false }`). Имя — только при согласии (Q2). */
const canReset = (profile: RiderProfileModerationDetail, action: ResetAction) =>
  action === 'resetAvatar'
    ? profile.avatar !== null
    : action === 'resetClub'
      ? profile.club !== null
      : profile.name !== null;

function Preview({ profile, label }: { profile: RiderProfileModerationDetail; label: string }) {
  return (
    <div className="form-column">
      <div className="form-group">
        {profile.avatar ? (
          <img
            className="avatar-preview"
            src={api.riderAvatarUrl(profile.avatar.id)}
            alt={t('admin.riderProfiles.photo', { label })}
          />
        ) : (
          <div
            className="avatar-preview"
            role="img"
            aria-label={t('admin.riderProfiles.noPhoto')}
          />
        )}
        <ReadonlyField
          label={t('admin.riderProfiles.field.status')}
          value={
            <StatusTag tone={profile.isPublic ? 'success' : 'neutral'}>
              {t(`admin.riderProfiles.status.${profile.isPublic ? 'public' : 'hidden'}`)}
            </StatusTag>
          }
        />
        <ReadonlyField
          label={t('admin.riderProfiles.field.club')}
          value={profile.club ?? t('admin.riderProfiles.none')}
        />
      </div>
    </div>
  );
}

/**
 * Карточка модерации профиля райдера (`profiles.moderate`, profile-moderation): фото (и у скрытого профиля, S-2),
 * подпись (имя — по Q2), клуб, статус публичности, жалобы без автора. «Сбросить фото / клуб / имя» неактивны, когда
 * сбрасывать нечего; «Отклонить жалобы» — при открытых, шлёт `reportRevision`. Каждое действие — `ReasonDialog` с
 * предупреждением не повторять имя и клуб (D11); 409 `CONFLICT` — `ConflictBanner` с перечитыванием карточки; 404
 * (профиль стёрт) — перечитывание и «Профиль не найден». Ошибка перечитывания при показанных данных — баннер с повтором.
 */
export function RiderProfileScreen({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const profile = useQuery(riderProfileQuery(userId));
  const [action, setAction] = useState<Action>();
  const [stale, setStale] = useState(false);
  const reasonId = useId();

  const crumb = (
    <Link className="link" to="/rider-profiles">
      {t('admin.riderProfiles.title')}
    </Link>
  );

  // ошибка перечитывания при показанной карточке: 403 и 404 (профиль стёрт) — как при первой загрузке, карточка и
  // действия убираются; прочее — баннер с повтором поверх последних данных (AGENTS.md §4.12), как в `rider-routes`
  if (profile.isError && isForbidden(profile.error)) return <NoAccessScreen />;
  const notFound = profile.isError && httpStatus(profile.error) === 404;
  if (!profile.data || notFound) {
    if (profile.isError || profile.fetchStatus === 'paused') {
      return (
        <>
          <PageHeader crumb={crumb} title={t('admin.riderProfiles.title')} />
          <div className="page-body">
            {notFound ? (
              <EmptyState title={t('admin.riderProfiles.notFound')} />
            ) : (
              <ErrorState
                error={profile.error}
                offline={profile.fetchStatus === 'paused'}
                onRetry={() => void profile.refetch()}
              />
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <PageHeader crumb={crumb} title={<span className="skeleton"> </span>} />
        <div className="page-body form-column" aria-busy="true">
          <span className="skeleton avatar-preview" />
          {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
            <div key={index} className="field" data-testid="skeleton-field">
              <span className="skeleton t-label"> </span>
              <span className="skeleton table__skeleton field__control"> </span>
            </div>
          ))}
        </div>
      </>
    );
  }

  const data = profile.data;
  const label = riderLabel(data.userId, data.name);
  const blocked = RESETS.some((value) => !canReset(data, value));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: RIDER_PROFILES_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const reload = async () => {
    const result = await profile.refetch();
    if (result.isSuccess) setStale(false);
  };
  const run = async (reason: string) => {
    try {
      if (action === 'resetAvatar') await api.resetRiderAvatar(data.userId, { reason });
      else if (action === 'resetClub') await api.resetRiderClub(data.userId, { reason });
      else if (action === 'resetName') await api.resetRiderName(data.userId, { reason });
      else if (action === 'dismiss') {
        await api.dismissRiderProfileReports(data.userId, {
          reason,
          reportRevision: data.reportRevision,
        });
      }
    } catch (error) {
      // 404 — профиль стёрт между открытием карточки и действием: перечитывание покажет «Профиль не найден»
      if (httpStatus(error) === 404) {
        await refresh();
        return;
      }
      if (!isConflict(error)) throw error;
      setStale(true);
      return;
    }
    await refresh();
  };

  const actions = [
    ...RESETS.map((value) => {
      const enabled = canReset(data, value);
      return (
        <Button
          key={value}
          variant="danger"
          disabled={!enabled}
          aria-describedby={enabled ? undefined : reasonId}
          onClick={() => setAction(value)}
        >
          {t(`admin.riderProfiles.${value}`)}
        </Button>
      );
    }),
    ...(data.openReportCount > 0
      ? [
          <Button key="dismiss" onClick={() => setAction('dismiss')}>
            {t('admin.riderProfiles.dismiss')}
          </Button>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader crumb={crumb} title={label} actions={actions} />
      <div className="page-body">
        {blocked ? (
          <DisabledReason id={reasonId}>{t('admin.riderProfiles.nothingToReset')}</DisabledReason>
        ) : null}
        {profile.isError ? (
          <Banner
            tone="error"
            role="alert"
            title={t('admin.refreshFailed')}
            actions={
              <Button size="sm" busy={profile.isFetching} onClick={() => void reload()}>
                {t('state.retry')}
              </Button>
            }
          >
            {t('admin.refreshFailedMessage')}
          </Banner>
        ) : null}
        {stale ? (
          <ConflictBanner
            busy={profile.isFetching}
            title={t('admin.riderProfiles.conflict')}
            message={t('admin.riderProfiles.conflictMessage')}
            onReload={() => void reload()}
          />
        ) : null}
        <Preview profile={data} label={label} />
        <h2 className="form-group__title t-label">{t('admin.riderProfiles.reportsTitle')}</h2>
        <DataTable
          caption={t('admin.riderProfiles.reportsTitle')}
          columns={reportColumns}
          query={{
            data: data.reports,
            isError: false,
            error: null,
            refetch: () => profile.refetch(),
          }}
          getRowId={(report) => report.id}
          empty={<EmptyState title={t('admin.riderProfiles.noReports')} />}
        />
      </div>
      <ReasonDialog
        open={action !== undefined}
        title={action ? t(`admin.riderProfiles.${action}Title`, { label }) : ''}
        consequences={action ? t(`admin.riderProfiles.${action}Consequences`) : ''}
        extraFields={<Banner tone="warning">{t('admin.riderProfiles.reasonWarning')}</Banner>}
        confirmLabel={action ? t(`admin.riderProfiles.${action}`) : ''}
        destructive={action !== undefined && action !== 'dismiss'}
        errorText={actionErrorText}
        onConfirm={run}
        onClose={() => setAction(undefined)}
      />
    </>
  );
}
