import {
  MEMBER_STATUSES,
  PANEL_MEMBER_LIST_CAP,
  PANEL_ROLES,
  type PanelMember,
  type PanelRole,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { api } from '../../api';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/can';
import { isForbidden } from '../../session/errors';
import { useMe } from '../../session/me';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  ReasonDialog,
  SelectField,
  StatusTag,
  TextField,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { GrantRoleDialog } from './GrantRoleDialog';
import { memberErrorText } from './member-errors';
import { membersQuery, MEMBERS_QUERY_KEY } from './members-query';

type Action = { kind: 'change' | 'revoke' | 'resetTotp'; member: PanelMember } | undefined;

const ALL = 'all';
const roleLabel = (role: PanelRole) => t(`admin.role.${role}`);
const ROLE_OPTIONS = PANEL_ROLES.map((role) => ({ value: role, label: roleLabel(role) }));
const column = createColumnHelper<PanelMember>();

/**
 * «Сотрудники» (`members.read`; действия — `members.manage`, только admin): плотная таблица (имя, e-mail, роль,
 * статус, выдана), фильтры статуса и роли, поиск; «Выдать роль», «Изменить роль», «Снять роль» и «Сбросить 2FA» (ADR-0024) с причиной. Своя
 * строка — без действий (сервер всё равно отказал бы `PANEL_SELF_ACTION`).
 */
export function MembersScreen() {
  const me = useMe();
  const canManage = useCan('members.manage');
  const queryClient = useQueryClient();
  const members = useQuery({ ...membersQuery, select: (list) => list.items });
  const truncated = useQuery({ ...membersQuery, select: (list) => list.truncated }).data;
  const [status, setStatus] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [granting, setGranting] = useState(false);
  const [action, setAction] = useState<Action>();
  const [newRole, setNewRole] = useState<PanelRole>('moderator');

  const filter = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (member: PanelMember) =>
      (status === ALL || member.status === status) &&
      (role === ALL || member.role === role) &&
      (needle === '' ||
        member.displayName.toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle));
  }, [status, role, search]);

  const columns = useMemo(
    () => [
      column.accessor('displayName', {
        header: t('admin.members.column.name'),
        cell: (info) =>
          info.row.original.userId === me?.user.id
            ? `${info.getValue()} (${t('admin.members.you')})`
            : info.getValue(),
      }),
      column.accessor('email', { header: t('admin.members.column.email') }),
      column.accessor('role', {
        header: t('admin.members.column.role'),
        cell: (info) => roleLabel(info.getValue()),
      }),
      column.accessor('status', {
        header: t('admin.members.column.status'),
        cell: (info) => (
          <StatusTag tone={info.getValue() === 'active' ? 'success' : 'neutral'}>
            {t(`admin.status.${info.getValue()}`)}
          </StatusTag>
        ),
      }),
      column.accessor('totpEnabled', {
        header: t('admin.members.column.totp'),
        cell: (info) => (
          <StatusTag tone={info.getValue() ? 'success' : 'neutral'}>
            {t(info.getValue() ? 'admin.members.totpOn' : 'admin.members.totpOff')}
          </StatusTag>
        ),
      }),
      column.accessor('grantedAt', {
        header: t('admin.members.column.grantedAt'),
        cell: (info) => formatDateTime(info.getValue()),
      }),
      column.display({
        id: 'actions',
        header: () => <span className="visually-hidden">{t('admin.members.column.actions')}</span>,
        cell: (info) => {
          const member = info.row.original;
          if (!canManage || member.userId === me?.user.id) return null;
          // роль меняют и снимают только у действующих; сброс 2FA — при любом статусе (task.md §8.2 п. 6)
          const active = member.status === 'active';
          if (!active && !member.totpEnabled) return null;
          return (
            <span className="table__actions">
              {active ? (
                <>
                  <Button
                    size="sm"
                    aria-label={`${t('admin.members.change')}: ${member.displayName}`}
                    onClick={() => {
                      setNewRole(
                        PANEL_ROLES.find((option) => option !== member.role) ?? member.role,
                      );
                      setAction({ kind: 'change', member });
                    }}
                  >
                    {t('admin.members.change')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`${t('admin.members.revoke')}: ${member.displayName}`}
                    onClick={() => setAction({ kind: 'revoke', member })}
                  >
                    {t('admin.members.revoke')}
                  </Button>
                </>
              ) : null}
              {member.totpEnabled ? (
                <Button
                  size="sm"
                  aria-label={`${t('admin.members.resetTotp')}: ${member.displayName}`}
                  onClick={() => setAction({ kind: 'resetTotp', member })}
                >
                  {t('admin.members.resetTotp')}
                </Button>
              ) : null}
            </span>
          );
        },
      }),
    ],
    [canManage, me?.user.id],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
    ]);
  };
  // мутации — через кэш мутаций: глобальные 401/403 (query-client.ts) срабатывают и здесь
  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: PanelRole; reason: string }) =>
      api.changeRole(input.userId, { role: input.role, reason: input.reason }),
    onSuccess: refresh,
  });
  const resetTotp = useMutation({
    mutationFn: (input: { userId: string; reason: string }) =>
      api.resetMemberTotp(input.userId, { reason: input.reason }),
    onSuccess: refresh,
  });
  const revokeRole = useMutation({
    mutationFn: (input: { userId: string; reason: string }) =>
      api.revokeRole(input.userId, { reason: input.reason }),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader
        title={t('admin.members.title')}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setGranting(true)}>
              {t('admin.members.grant')}
            </Button>
          ) : null
        }
      />
      <div className="page-body">
        <DataTable
          caption={t('admin.members.title')}
          columns={columns}
          query={members}
          getRowId={(member) => member.userId}
          initialSorting={[{ id: 'grantedAt', desc: true }]}
          filter={filter}
          empty={<EmptyState title={t('admin.members.empty')} />}
          noMatches={t('admin.members.noMatches')}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <>
              <SelectField
                label={t('admin.members.filter.status')}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                options={[
                  { value: ALL, label: t('admin.members.filter.all') },
                  ...MEMBER_STATUSES.map((value) => ({
                    value,
                    label: t(`admin.status.${value}`),
                  })),
                ]}
              />
              <SelectField
                label={t('admin.members.filter.role')}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                options={[{ value: ALL, label: t('admin.members.filter.all') }, ...ROLE_OPTIONS]}
              />
              <TextField
                label={t('admin.members.search')}
                type="search"
                placeholder={t('admin.members.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </>
          }
          footer={
            truncated ? (
              <p className="table__more muted t-meta">
                {t('admin.members.truncated', { count: PANEL_MEMBER_LIST_CAP })}
              </p>
            ) : null
          }
        />
      </div>

      <GrantRoleDialog open={granting} onClose={() => setGranting(false)} />
      <ReasonDialog
        open={action?.kind === 'change'}
        title={t('admin.members.changeTitle', { name: action?.member.displayName ?? '' })}
        consequences={t('admin.members.changeConsequences')}
        confirmLabel={t('admin.members.changeSubmit')}
        extraFields={
          <SelectField
            label={t('admin.members.newRole')}
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as PanelRole)}
            options={ROLE_OPTIONS.filter((option) => option.value !== action?.member.role)}
          />
        }
        errorText={memberErrorText}
        onConfirm={async (reason) => {
          if (!action) return;
          await changeRole.mutateAsync({ userId: action.member.userId, role: newRole, reason });
        }}
        onClose={() => setAction(undefined)}
      />
      <ReasonDialog
        open={action?.kind === 'revoke'}
        title={t('admin.members.revokeTitle', { name: action?.member.displayName ?? '' })}
        consequences={t('admin.members.revokeConsequences')}
        confirmLabel={t('admin.members.revoke')}
        destructive
        errorText={memberErrorText}
        onConfirm={async (reason) => {
          if (!action) return;
          await revokeRole.mutateAsync({ userId: action.member.userId, reason });
        }}
        onClose={() => setAction(undefined)}
      />
      <ReasonDialog
        open={action?.kind === 'resetTotp'}
        title={t('admin.members.resetTotpTitle', { name: action?.member.displayName ?? '' })}
        consequences={t('admin.members.resetTotpConsequences')}
        confirmLabel={t('admin.members.resetTotp')}
        destructive
        errorText={memberErrorText}
        onConfirm={async (reason) => {
          if (!action) return;
          await resetTotp.mutateAsync({ userId: action.member.userId, reason });
        }}
        onClose={() => setAction(undefined)}
      />
    </>
  );
}
