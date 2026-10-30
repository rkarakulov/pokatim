import {
  PANEL_INVITATION_LIST_CAP,
  type PanelInvitation,
  type PanelRole,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { api } from '../../api';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/can';
import { Banner, Button, DataTable, Dialog, EmptyState, StatusTag } from '../../ui';
import { INVITATIONS_QUERY_KEY, invitationsQuery } from './invitations-query';
import { memberErrorText } from './member-errors';

const column = createColumnHelper<PanelInvitation>();
const roleLabel = (role: PanelRole) => t(`admin.role.${role}`);

/**
 * Блок «Приглашения» под «Сотрудниками» (ADR-0026): живые приглашения (`members.read`); «Истекло» и «Письмо не
 * отправлено» — признаки сервера. «Отправить повторно» — то же приглашение заново (прежняя ссылка гаснет),
 * «Отозвать» — подтверждение без причины (`members.manage`). Состояния — `DataTable` (§4.12).
 */
export function InvitationsSection() {
  const canManage = useCan('members.manage');
  const queryClient = useQueryClient();
  const invitations = useQuery({ ...invitationsQuery, select: (list) => list.items });
  const truncated = useQuery({ ...invitationsQuery, select: (list) => list.truncated }).data;
  const [revoking, setRevoking] = useState<PanelInvitation>();
  const [notice, setNotice] = useState<{ tone: 'neutral' | 'error'; text: string }>();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
    ]);
  };
  const resend = useMutation({
    mutationFn: (invitation: PanelInvitation) =>
      api.invite({
        email: invitation.email,
        displayName: invitation.displayName,
        role: invitation.role,
      }),
    onSuccess: async (_result, invitation) => {
      setNotice({
        tone: 'neutral',
        text: t('admin.invitations.resent', { email: invitation.email }),
      });
      await refresh();
    },
    onError: (error) => setNotice({ tone: 'error', text: memberErrorText(error) }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: refresh,
    onError: async (error) => {
      setNotice({ tone: 'error', text: memberErrorText(error) });
      await refresh();
    },
  });

  const columns = useMemo(
    () => [
      column.accessor('email', { header: t('admin.invitations.column.email') }),
      column.accessor('displayName', { header: t('admin.invitations.column.name') }),
      column.accessor('role', {
        header: t('admin.invitations.column.role'),
        cell: (info) => roleLabel(info.getValue()),
      }),
      column.accessor('invitedBy', { header: t('admin.invitations.column.invitedBy') }),
      column.accessor('createdAt', {
        header: t('admin.invitations.column.createdAt'),
        cell: (info) => formatDateTime(info.getValue()),
      }),
      column.accessor('expiresAt', {
        header: t('admin.invitations.column.expiresAt'),
        cell: (info) => {
          const invitation = info.row.original;
          return (
            <span className="table__actions">
              {invitation.expired ? (
                <StatusTag tone="neutral">{t('admin.invitations.expired')}</StatusTag>
              ) : (
                formatDateTime(info.getValue())
              )}
              {invitation.emailState === 'failed' ? (
                <StatusTag tone="error">{t('admin.invitations.emailFailed')}</StatusTag>
              ) : null}
            </span>
          );
        },
      }),
      column.display({
        id: 'actions',
        header: () => (
          <span className="visually-hidden">{t('admin.invitations.column.actions')}</span>
        ),
        cell: (info) => {
          if (!canManage) return null;
          const invitation = info.row.original;
          return (
            <span className="table__actions">
              <Button
                size="sm"
                aria-label={`${t('admin.invitations.resend')}: ${invitation.email}`}
                busy={resend.isPending && resend.variables.id === invitation.id}
                disabled={resend.isPending}
                onClick={() => {
                  setNotice(undefined);
                  resend.mutate(invitation);
                }}
              >
                {t('admin.invitations.resend')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                aria-label={`${t('admin.invitations.revoke')}: ${invitation.email}`}
                onClick={() => {
                  setNotice(undefined);
                  setRevoking(invitation);
                }}
              >
                {t('admin.invitations.revoke')}
              </Button>
            </span>
          );
        },
      }),
    ],
    [canManage, resend],
  );

  return (
    <section className="form-group" aria-label={t('admin.invitations.title')}>
      <h2 className="form-group__title t-label">{t('admin.invitations.title')}</h2>
      {notice ? (
        <Banner tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </Banner>
      ) : null}
      <DataTable
        caption={t('admin.invitations.title')}
        columns={columns}
        query={invitations}
        getRowId={(invitation) => invitation.id}
        initialSorting={[{ id: 'createdAt', desc: true }]}
        empty={<EmptyState title={t('admin.invitations.empty')} />}
        footer={
          truncated ? (
            <p className="table__more muted t-meta">
              {t('admin.invitations.truncated', { count: PANEL_INVITATION_LIST_CAP })}
            </p>
          ) : null
        }
      />
      <Dialog
        open={revoking !== undefined}
        title={t('admin.invitations.revokeTitle', { email: revoking?.email ?? '' })}
        onClose={() => setRevoking(undefined)}
      >
        <p className="dialog__consequences t-body">{t('admin.invitations.revokeConsequences')}</p>
        <div className="dialog__actions">
          <Button onClick={() => setRevoking(undefined)}>
            {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (revoking) revoke.mutate(revoking.id);
              setRevoking(undefined);
            }}
          >
            {t('admin.invitations.revoke')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
