import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf } from '@pokatim/api-client';
import { GrantRoleRequest, PANEL_INVITATION_TTL_DAYS, PANEL_ROLES } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { api } from '../../api';
import { fieldErrorText } from '../../field-errors';
import { Banner, Button, Dialog, SelectField, TextField } from '../../ui';
import { INVITATIONS_QUERY_KEY } from './invitations-query';
import { EMAIL_FIELD_CODES, memberErrorText } from './member-errors';
import { MEMBERS_QUERY_KEY } from './members-query';

const ROLE_OPTIONS = PANEL_ROLES.map((role) => ({ value: role, label: t(`admin.role.${role}`) }));

export type GrantMode = 'grant' | 'invite';

/**
 * «Выдать роль» — существующему пользователю приложения с подтверждённым e-mail (R4а): нет аккаунта, не подтверждён,
 * уже в команде — ошибка под полем e-mail; нет аккаунта — ещё действие «Отправить приглашение» с теми же полями.
 * Режим `invite` (ADR-0026) — та же форма: «Пригласить в команду» → «Отправить приглашение» (аккаунта может не быть).
 */
export function GrantRoleDialog({
  open,
  mode: initialMode = 'grant',
  onClose,
}: {
  open: boolean;
  mode?: GrantMode;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<GrantMode>(initialMode);
  const [failure, setFailure] = useState<string>();
  const [noAccount, setNoAccount] = useState(false);
  const form = useForm({
    resolver: zodResolver(GrantRoleRequest),
    defaultValues: { email: '', displayName: '', role: 'moderator' as const },
  });
  const close = () => {
    form.reset();
    setFailure(undefined);
    setNoAccount(false);
    setMode(initialMode);
    onClose();
  };
  const onError = (error: unknown) => {
    const code = apiErrorOf(error)?.code ?? '';
    if (EMAIL_FIELD_CODES.has(code)) {
      const noAccountHere = mode === 'grant' && code === 'NOT_FOUND';
      // подсказка «пригласите» — только в «Выдать роль» по e-mail; в остальных окнах NOT_FOUND — нейтральный текст
      const message = noAccountHere
        ? t('admin.members.error.grantNotFound')
        : memberErrorText(error);
      form.setError('email', { type: 'server', message });
      setNoAccount(noAccountHere);
    } else {
      setFailure(memberErrorText(error));
    }
  };
  const submit = useMutation({
    mutationFn: async (body: GrantRoleRequest) => {
      if (mode === 'invite') await api.invite(body);
      else await api.grantRole(body);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
      ]);
      close();
    },
    onError,
  });
  const errors = form.formState.errors;
  // ошибки сервера уже текст; ошибки схемы — коды контракта
  const emailError =
    errors.email?.type === 'server' ? errors.email.message : fieldErrorText(errors.email?.message);
  const inviting = mode === 'invite';

  return (
    <Dialog
      open={open}
      title={t(inviting ? 'admin.members.inviteTitle' : 'admin.members.grantTitle')}
      onClose={close}
    >
      <p className="dialog__consequences t-body">
        {inviting
          ? t('admin.members.inviteLead', { count: PANEL_INVITATION_TTL_DAYS })
          : t('admin.members.grantLead')}
      </p>
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((body) => {
            setFailure(undefined);
            setNoAccount(false);
            submit.mutate(body);
          })(event)
        }
      >
        <TextField
          label={t(inviting ? 'admin.members.inviteEmail' : 'admin.members.email')}
          type="email"
          autoComplete="off"
          error={emailError}
          {...form.register('email')}
        />
        {noAccount ? (
          <Button
            size="sm"
            onClick={() => {
              form.clearErrors('email');
              setNoAccount(false);
              setMode('invite');
            }}
          >
            {t('admin.members.sendInvite')}
          </Button>
        ) : null}
        <TextField
          label={t('admin.members.displayName')}
          autoComplete="off"
          error={fieldErrorText(errors.displayName?.message)}
          {...form.register('displayName')}
        />
        <SelectField
          label={t('admin.members.role')}
          options={ROLE_OPTIONS}
          {...form.register('role')}
        />
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <div className="dialog__actions">
          <Button onClick={close} disabled={submit.isPending}>
            {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
          </Button>
          <Button type="submit" variant="primary" busy={submit.isPending}>
            {t(inviting ? 'admin.members.inviteSubmit' : 'admin.members.grantSubmit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
