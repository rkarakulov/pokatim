import type { PanelResultGroup, PanelStandingRow, ResultGroupKey } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useId, useState } from 'react';

import { api } from '../../api';
import { formatElapsed } from '../../format';
import { useCan } from '../../session/can';
import { Banner, Button, ChipGroup, DataTable, EmptyState, StatusTag, ToggleChip } from '../../ui';
import { FlagList } from './FlagList';
import type { OpenResultsDialog } from './results-actions';
import { placeLabel, RESULT_TONE, riderLabel } from './results-format';
import { standingsQuery } from './results-query';
import { type DemographicsTarget, VerifiedDemographicsDialog } from './VerifiedDemographicsDialog';

const column = createColumnHelper<PanelStandingRow>();
const ALL_GROUPS = 'all';
type GroupFilter = ResultGroupKey | typeof ALL_GROUPS;

const placeColumn = column.accessor('place', {
  header: t('admin.results.column.place'),
  cell: (info) => placeLabel(info.getValue(), info.row.original.tied),
  enableSorting: false,
});
const riderColumn = column.accessor((row) => riderLabel(row.entryId, row.riderName), {
  id: 'rider',
  header: t('admin.results.column.rider'),
  enableSorting: false,
});
const groupColumn = column.accessor('groupKey', {
  header: t('admin.results.column.group'),
  cell: (info) => t(`results.group.${info.getValue()}`),
  enableSorting: false,
});
const tierColumn = column.accessor('tier', {
  header: t('admin.results.column.tier'),
  cell: (info) => t(`results.tier.${info.getValue()}`),
  enableSorting: false,
});
const timeColumn = column.accessor('elapsedSec', {
  header: t('admin.results.column.time'),
  cell: (info) => {
    const value = info.getValue();
    return value === null ? '—' : formatElapsed(value);
  },
  enableSorting: false,
});
const statusColumn = column.accessor('resultStatus', {
  header: t('admin.results.column.status'),
  cell: (info) => (
    <StatusTag tone={RESULT_TONE[info.getValue()]}>
      {t(`admin.results.resultStatus.${info.getValue()}`)}
    </StatusTag>
  ),
  enableSorting: false,
});
const unrankedColumn = column.accessor('unranked', {
  header: t('admin.results.column.unranked'),
  cell: (info) => {
    const value = info.getValue();
    return value === null ? '—' : t(`results.unranked.${value}`);
  },
  enableSorting: false,
});
const attentionColumn = column.display({
  id: 'attention',
  header: t('admin.results.column.attention'),
  cell: (info) => <FlagList flags={info.row.original.flags} />,
});
const attemptsColumn = column.accessor((row) => row.summary.total, {
  id: 'attempts',
  header: t('admin.results.column.attempts'),
  enableSorting: false,
});

/** «Участники»: строки с местом и прочие заявки (DNS, не засчитано, отменено) — без финишёров. */
const rankedColumns = [
  placeColumn,
  riderColumn,
  groupColumn,
  tierColumn,
  timeColumn,
  statusColumn,
  attentionColumn,
  attemptsColumn,
];
/** «Финишёры» (START, Verified без пульса): время без места, причина вместо статуса. */
const finisherColumns = [
  riderColumn,
  groupColumn,
  tierColumn,
  timeColumn,
  unrankedColumn,
  attentionColumn,
  attemptsColumn,
];

/**
 * «Участники»: места и статусы считает сервер (до публикации — живые, после — текущая ревизия протокола). После
 * публикации с `results.revise` — «Дисквалифицировать» / «Отменить DQ» (D-27). Публичное имя — только с согласием
 * райдера; с `profiles.moderate` при имени — «Сбросить имя» (profile-02).
 *
 * race-results-07: вкладки групп (`groups` ответа) и фильтр «Требует внимания» — на сервере (`group`, `attention`);
 * колонки группы, уровня и флагов; финишёры (`unranked ≠ null`) — отдельным блоком без мест и отдельным запросом
 * (`finishers`: серверный фильтр до предела ответа, свой `truncated`). С
 * `profiles.verified_edit` у Verified в группе пол × возраст — «Пол и год» (окно с причиной).
 */
export function StandingsTable({
  raceId,
  published,
  finishersTotal,
  run,
  open,
}: {
  raceId: string;
  published: boolean;
  /** финишёров в гонке (`counts.finishers`): блок виден, если они есть */
  finishersTotal: number;
  run: (call: () => Promise<unknown>) => Promise<void>;
  open: OpenResultsDialog;
}) {
  const titleId = useId();
  const finishersTitleId = useId();
  const canRevise = useCan('results.revise');
  const canModerate = useCan('profiles.moderate');
  const canEditDemographics = useCan('profiles.verified_edit');
  const [group, setGroup] = useState<GroupFilter>(ALL_GROUPS);
  const [attention, setAttention] = useState(false);
  const [demographics, setDemographics] = useState<DemographicsTarget | null>(null);
  const filter = {
    ...(group === ALL_GROUPS ? {} : { group }),
    ...(attention ? { attention: 'true' as const } : {}),
  };
  const standings = useQuery(standingsQuery(raceId, filter));
  // финишёры — отдельным запросом с серверным фильтром: за пределом строк «Участников» не теряются
  const finisherRows = useQuery({
    ...standingsQuery(raceId, { ...filter, finishers: 'true' }),
    enabled: finishersTotal > 0,
  });
  // на время смены фильтра — скелетон таблиц (прежний ответ держит только вкладки групп)
  const items = standings.isPlaceholderData ? undefined : standings.data?.items;
  // вкладки групп — из последнего ответа: при загрузке и ошибке другого фильтра остаются на месте
  const [groups, setGroups] = useState<readonly PanelResultGroup[]>([]);
  const latestGroups = standings.data?.groups;
  if (latestGroups && latestGroups !== groups) setGroups(latestGroups);

  /** «Дисквалифицировать» / «Отменить DQ» опубликованного результата (D-27). */
  const disqualifyAction = (row: PanelStandingRow) => {
    if (row.resultStatus === 'dq') {
      return (
        <Button
          size="sm"
          onClick={() =>
            open({
              title: t('admin.results.dialog.revokeDq'),
              consequences: t('admin.results.dialog.revokeDqConsequences'),
              confirmLabel: t('admin.results.action.revokeDq'),
              run: (reason) =>
                run(() => api.revokeDisqualification(raceId, { entryId: row.entryId, reason })),
            })
          }
        >
          {t('admin.results.action.revokeDq')}
        </Button>
      );
    }
    if (row.resultStatus !== 'final' && row.resultStatus !== 'revised') return null;
    return (
      <Button
        size="sm"
        variant="danger"
        onClick={() =>
          open({
            title: t('admin.results.dialog.disqualify'),
            consequences: t('admin.results.dialog.disqualifyConsequences'),
            confirmLabel: t('admin.results.action.disqualify'),
            destructive: true,
            run: (reason) =>
              run(() => api.disqualifyResult(raceId, { entryId: row.entryId, reason })),
          })
        }
      >
        {t('admin.results.action.disqualify')}
      </Button>
    );
  };

  /** Пол и год анкеты: только Verified в группе пол × возраст (у них анкета зафиксирована заявкой). */
  const demographicsAction = (row: PanelStandingRow) =>
    canEditDemographics && row.tier === 'verified' && row.groupKey !== 'overall' ? (
      <Button
        size="sm"
        onClick={() =>
          setDemographics({ userId: row.userId, label: riderLabel(row.entryId, row.riderName) })
        }
      >
        {t('admin.results.action.editDemographics')}
      </Button>
    ) : null;

  const canDisqualify = published && canRevise;
  const actions =
    canDisqualify || canModerate || canEditDemographics
      ? column.display({
          id: 'actions',
          header: t('admin.results.column.actions'),
          cell: (info) => {
            const row = info.row.original;
            const dq = canDisqualify ? disqualifyAction(row) : null;
            const reset =
              canModerate && row.riderName !== null ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    open({
                      title: t('admin.results.dialog.resetName'),
                      consequences: t('admin.results.dialog.resetNameConsequences'),
                      confirmLabel: t('admin.results.action.resetName'),
                      destructive: true,
                      run: (reason) => run(() => api.resetRiderName(row.userId, { reason })),
                    })
                  }
                >
                  {t('admin.results.action.resetName')}
                </Button>
              ) : null;
            const edit = demographicsAction(row);
            if (!dq && !reset && !edit) return null;
            return (
              <span className="table__actions">
                {dq}
                {edit}
                {reset}
              </span>
            );
          },
        })
      : null;

  const query = (state: typeof standings, data: PanelStandingRow[] | undefined) => ({
    data,
    isError: state.isError,
    error: state.error,
    fetchStatus: state.fetchStatus,
    refetch: () => state.refetch(),
  });
  const filtered = group !== ALL_GROUPS || attention;
  const finishers = finisherRows.isPlaceholderData
    ? undefined
    : finisherRows.data?.items.filter((row) => row.unranked !== null);

  return (
    <>
      <section className="section" aria-labelledby={titleId}>
        <h2 id={titleId} className="section__title t-label">
          {t('admin.results.standings.title')}
        </h2>
        {standings.data?.truncated && !standings.isPlaceholderData ? (
          <Banner>
            {t('admin.results.standings.truncated', { count: standings.data.items.length })}
          </Banner>
        ) : null}
        <DataTable
          caption={t('admin.results.standings.title')}
          columns={actions ? [...rankedColumns, actions] : rankedColumns}
          query={query(
            standings,
            items?.filter((row) => row.unranked === null),
          )}
          getRowId={(row) => row.entryId}
          empty={
            <EmptyState
              title={t(
                filtered
                  ? 'admin.results.standings.emptyFiltered'
                  : 'admin.results.standings.empty',
              )}
            />
          }
          toolbar={
            <>
              {groups.length > 0 ? (
                // одна группа за раз: нажатый чип заменяет прежний, «Все группы» — без фильтра
                <ChipGroup
                  label={t('admin.results.standings.groupFilter')}
                  options={[
                    { value: ALL_GROUPS, label: t('admin.results.standings.allGroups') },
                    ...groups.map((item) => ({
                      value: item.key,
                      label: t('admin.results.standings.groupOption', {
                        group: t(`results.group.${item.key}`),
                        count: item.ranked,
                      }),
                    })),
                  ]}
                  value={[group]}
                  onChange={(next) => setGroup(next.find((value) => value !== group) ?? ALL_GROUPS)}
                />
              ) : null}
              <div className="toolbar__spacer">
                <ToggleChip pressed={attention} onToggle={() => setAttention(!attention)}>
                  {t('admin.results.standings.attentionFilter')}
                </ToggleChip>
              </div>
            </>
          }
        />
      </section>
      {finishersTotal > 0 ? (
        <section className="section" aria-labelledby={finishersTitleId}>
          <h2 id={finishersTitleId} className="section__title t-label">
            {t('admin.results.finishers.title')}
          </h2>
          <p className="page-note t-meta">{t('admin.results.finishers.note')}</p>
          {finisherRows.data?.truncated && !finisherRows.isPlaceholderData ? (
            <Banner>
              {t('admin.results.finishers.truncated', { count: finisherRows.data.items.length })}
            </Banner>
          ) : null}
          <DataTable
            caption={t('admin.results.finishers.title')}
            columns={actions ? [...finisherColumns, actions] : finisherColumns}
            query={query(finisherRows, finishers)}
            getRowId={(row) => row.entryId}
            empty={<EmptyState title={t('admin.results.finishers.empty')} />}
          />
        </section>
      ) : null}
      <VerifiedDemographicsDialog target={demographics} onClose={() => setDemographics(null)} />
    </>
  );
}
