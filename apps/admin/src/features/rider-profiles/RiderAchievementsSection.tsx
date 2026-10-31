import { isSeasonalCode, type RiderAchievementAdminItem } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useId, useState } from 'react';

import { api } from '../../api';
import { formatLocalDate } from '../../format';
import { isForbidden } from '../../session/errors';
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  ReasonDialog,
  RefreshFailedBanner,
  StatusTag,
} from '../../ui';
import { GrantAchievementDialog } from './GrantAchievementDialog';
import {
  achievementActionErrorText,
  achievementName,
  byFactsLabel,
  decisionLabel,
  isInvalidState,
  isVisible,
  objectLabel,
  STATUS_TONE,
} from './rider-achievements-format';
import { RIDER_ACHIEVEMENTS_QUERY_KEY, riderAchievementsQuery } from './rider-achievements-query';

type RowAction = { kind: 'revoke' | 'clear'; item: RiderAchievementAdminItem };

const column = createColumnHelper<RiderAchievementAdminItem>();
const nameOf = (item: RiderAchievementAdminItem) => achievementName(item.code, item.level);
const rowKey = (item: RiderAchievementAdminItem) => `${item.code}:${item.object.id}`;

/** Адрес выдачи для отзыва и снятия: сезонная — с сезоном (`seasonId` ⇔ сезонный код). */
const targetOf = (item: RiderAchievementAdminItem) =>
  isSeasonalCode(item.code) ? { code: item.code, seasonId: item.object.id } : { code: item.code };

/**
 * Блок «Достижения» карточки райдера (achievements-panel, `achievements.manage` — рендерит `RiderProfileScreen` только с
 * правом): все выдачи со статусом, объектом, уровнем, датой факта, ручным решением и «По фактам» (RC-6). «Выдать
 * вручную» — `GrantAchievementDialog`; «Отозвать» (видимые) и «Вернуть автоматике» (ручные) — `ReasonDialog` с
 * предупреждением «причина видна команде». Свой запрос (не зависит от карточки); 403 — блока нет. После действия —
 * инвалидация блока и журнала; 409 — текст в окне и перечитывание.
 */
export function RiderAchievementsSection({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(riderAchievementsQuery(userId));
  const [granting, setGranting] = useState(false);
  const [action, setAction] = useState<RowAction>();
  const [notReconciled, setNotReconciled] = useState(false);
  const titleId = useId();

  if (query.isError && isForbidden(query.error)) return null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: RIDER_ACHIEVEMENTS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const reloadBlock = () =>
    queryClient.invalidateQueries({ queryKey: RIDER_ACHIEVEMENTS_QUERY_KEY });

  const run = async (reason: string) => {
    if (!action) return;
    const body = { ...targetOf(action.item), reason };
    try {
      if (action.kind === 'revoke') {
        await api.revokeRiderAchievement(userId, body);
        setNotReconciled(false);
      } else {
        const result = await api.clearRiderAchievementOverride(userId, body);
        setNotReconciled(result.cleared && !result.reconciled);
      }
    } catch (error) {
      if (isInvalidState(error)) await reloadBlock();
      throw error;
    }
    await refresh();
  };

  const rowButton = (kind: RowAction['kind'], item: RiderAchievementAdminItem) => {
    const label = t(`admin.riderAchievements.${kind}`);
    return (
      <Button
        key={kind}
        size="sm"
        variant={kind === 'revoke' ? 'danger' : 'secondary'}
        aria-label={t('admin.riderAchievements.rowAction', {
          action: label,
          name: nameOf(item),
          object: objectLabel(item.object),
        })}
        onClick={() => setAction({ kind, item })}
      >
        {label}
      </Button>
    );
  };

  const columns = [
    column.accessor(nameOf, {
      id: 'achievement',
      header: t('admin.riderAchievements.column.achievement'),
      enableSorting: false,
    }),
    column.accessor((item) => objectLabel(item.object), {
      id: 'object',
      header: t('admin.riderAchievements.column.object'),
      enableSorting: false,
    }),
    column.accessor('factDate', {
      header: t('admin.riderAchievements.column.factDate'),
      cell: (info) => formatLocalDate(info.getValue()),
      enableSorting: false,
    }),
    column.accessor('status', {
      header: t('admin.riderAchievements.column.status'),
      cell: (info) => (
        <StatusTag tone={STATUS_TONE[info.getValue()]}>
          {t(`admin.riderAchievements.status.${info.getValue()}`)}
        </StatusTag>
      ),
      enableSorting: false,
    }),
    column.accessor((item) => decisionLabel(item.override), {
      id: 'decision',
      header: t('admin.riderAchievements.column.decision'),
      enableSorting: false,
    }),
    column.accessor((item) => byFactsLabel(item.byFacts), {
      id: 'byFacts',
      header: t('admin.riderAchievements.column.byFacts'),
      enableSorting: false,
    }),
    column.display({
      id: 'actions',
      header: t('admin.riderAchievements.column.actions'),
      cell: (info) => {
        const item = info.row.original;
        return (
          <span className="table__actions">
            {isVisible(item) ? rowButton('revoke', item) : null}
            {item.override !== null ? rowButton('clear', item) : null}
          </span>
        );
      },
    }),
  ];

  const name = action ? nameOf(action.item) : '';

  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.riderAchievements.title')}
      </h2>
      <div className="toolbar">
        <Button onClick={() => setGranting(true)}>{t('admin.riderAchievements.grant')}</Button>
      </div>
      {query.data && query.isError ? (
        <RefreshFailedBanner busy={query.isFetching} onRetry={() => void query.refetch()} />
      ) : null}
      {notReconciled ? <Banner>{t('admin.riderAchievements.notReconciled')}</Banner> : null}
      {query.data?.seasonsAvailable === false ? (
        <Banner tone="warning" title={t('admin.riderAchievements.seasonsUnavailable')}>
          {t('admin.riderAchievements.seasonsUnavailableMessage')}
        </Banner>
      ) : null}
      <DataTable
        caption={t('admin.riderAchievements.title')}
        columns={columns}
        query={{
          data: query.data?.items,
          // ошибка обновления при данных — свой баннер выше (не общий «устарело» таблицы)
          isError: query.isError && !query.data,
          error: query.error,
          fetchStatus: query.fetchStatus,
          refetch: () => query.refetch(),
        }}
        getRowId={rowKey}
        empty={<EmptyState title={t('admin.riderAchievements.empty')} />}
      />
      <GrantAchievementDialog
        open={granting}
        userId={userId}
        items={query.data?.items ?? []}
        onDone={async () => {
          setNotReconciled(false);
          await refresh();
        }}
        onStale={async () => {
          await reloadBlock();
        }}
        onClose={() => setGranting(false)}
      />
      <ReasonDialog
        open={action !== undefined}
        title={
          action
            ? t(
                action.kind === 'revoke'
                  ? 'admin.riderAchievements.revokeTitle'
                  : 'admin.riderAchievements.clearTitle',
                { name },
              )
            : ''
        }
        consequences={
          action
            ? t(
                action.kind === 'revoke'
                  ? 'admin.riderAchievements.revokeConsequences'
                  : 'admin.riderAchievements.clearConsequences',
              )
            : ''
        }
        extraFields={<Banner tone="warning">{t('admin.riderAchievements.reasonWarning')}</Banner>}
        confirmLabel={action ? t(`admin.riderAchievements.${action.kind}`) : ''}
        destructive={action?.kind === 'revoke'}
        errorText={achievementActionErrorText}
        onConfirm={run}
        onClose={() => setAction(undefined)}
      />
    </section>
  );
}
